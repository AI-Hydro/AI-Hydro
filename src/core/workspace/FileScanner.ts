/**
 * Scans the open folders for map data files (the Project files list) and watches for changes.
 *
 * Bounds, because a project can hold thousands of files:
 *  - at most MAX_PROJECT_FILES files are kept; the scan asks for one more so the list can say `5,000+` and mean it;
 *  - a file is judged from its first few kilobytes (geoSniff.ts), never read whole;
 *  - watcher events and `files.exclude` changes are collected and handled in one batch after a short quiet period.
 */

import { AIHYDRO_STATE_DIR, MAX_PROJECT_FILES, PROJECT_FILE_EXTENSIONS } from "@shared/map/projectFiles"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import {
	buildExcludeGlob,
	isExcludedByNames,
	isExcludedWorkspaceGeoPath,
	mergeFilesExclude,
	WORKSPACE_GEO_EXCLUDED_DIRS,
} from "./geoScanExclusions"
import { looksLikeGeoJson, readPrefix } from "./geoSniff"
import { realPathInsideFolder } from "./workspaceGeoPaths"

const GEO_GLOB = `**/*.{${PROJECT_FILE_EXTENSIONS.join(",")}}`
/** Files judged at once. Each needs a stat and sometimes an 8 KB read; more than this only queues on the disk. */
const SCAN_CONCURRENCY = 16
/** Extensions that are text GeoJSON (or close enough to read as JSON); every other listed format is binary or converted. */
const JSON_TEXT = new Set([".geojson", ".json", ".topojson"])
/** Formats the extension host cannot read to text: the map panel's own parser loads them. */
export const WEBVIEW_PARSED_EXTENSIONS = new Set([".tif", ".tiff", ".kmz"])

/** What the last scan saw, for the "N folders skipped" and symlink lines. */
export interface ScanStats {
	foldersSkipped: number
	skippedNames: string[]
	symlinksFound: number
	/** Symlinked files that resolve outside their folder; they are not listed. */
	symlinksSkipped: number
	/** The scan stopped at its limit: the real count is higher. */
	truncated: boolean
	folderCount: number
}

export interface WorkspaceGeoJsonFile {
	uri: vscode.Uri
	/** Workspace folder the file belongs to (fsPath). Together with `relativePath` it is the file's identity. */
	workspaceFolder: string
	/** Display name of that folder (shown when the workspace has several). */
	workspaceFolderName: string
	relativePath: string
	name: string
	extension: string
	lastModified: number
	sizeBytes: number
	requiresConversion: boolean
}

export class FileScanner {
	private watcher: vscode.FileSystemWatcher | null = null
	private configWatcher: vscode.Disposable | null = null
	private files: Map<string, WorkspaceGeoJsonFile> = new Map()
	private onFilesChangedCallback: ((files: WorkspaceGeoJsonFile[]) => void) | null = null
	/** Listeners for every raw watcher event, before batching and before the list's own judging (the map's layer watcher). */
	private readonly fileEventListeners = new Set<(file: string) => void>()
	private debounceTimer: NodeJS.Timeout | null = null
	private readonly DEBOUNCE_MS = 500
	/** Watcher events waiting for the quiet period: `true` means check the file again, `false` means it is gone. */
	private pending = new Map<string, { uri: vscode.Uri; present: boolean }>()
	private batchTimer: NodeJS.Timeout | null = null
	private readonly BATCH_MS = 400
	private scanning: Promise<void> | null = null
	private extraExcludedDirs: string[] = []
	private stats: ScanStats = {
		foldersSkipped: 0,
		skippedNames: [],
		symlinksFound: 0,
		symlinksSkipped: 0,
		truncated: false,
		folderCount: 0,
	}

	/**
	 * Initialize the file scanner
	 */
	async initialize(workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<void> {
		// Initial scan
		await this.scanWorkspace(workspaceFolders)

		// Set up file watcher
		this.setupWatcher()
		console.log(`[FileScanner] Initialized with ${this.files.size} map files`)
	}

	/** What the last scan saw besides the files themselves. */
	getStats(): ScanStats {
		return { ...this.stats, skippedNames: [...this.stats.skippedNames] }
	}

	/**
	 * Scan the open folders for map data files. Scans never overlap: a second request while one runs waits for it and
	 * then runs once more, so a burst of requests costs at most two scans.
	 */
	private scanWorkspace(workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<void> {
		const run = () => this.scanOnce(workspaceFolders)
		const next = (this.scanning ?? Promise.resolve()).then(run, run)
		this.scanning = next.catch(() => {})
		return next
	}

	private async scanOnce(workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<void> {
		const found = new Map<string, WorkspaceGeoJsonFile>()
		const stats: ScanStats = {
			foldersSkipped: 0,
			skippedNames: [],
			symlinksFound: 0,
			symlinksSkipped: 0,
			truncated: false,
			folderCount: workspaceFolders.length,
		}
		const extraDirs = new Set<string>()
		const excluded = new Set<string>()
		let budget = MAX_PROJECT_FILES + 1

		for (const folder of workspaceFolders) {
			try {
				const merged = mergeFilesExclude(
					vscode.workspace.getConfiguration("files", folder.uri).get<Record<string, unknown>>("exclude"),
				)
				for (const name of merged.dirNames) extraDirs.add(name)
				for (const pattern of merged.unsupported) {
					console.warn(`[FileScanner] files.exclude pattern not merged (braces or commas): ${pattern}`)
				}
				// `findFiles` gives back the files that match; excluded directories are counted from the folder's top level.
				for (const name of await this.presentExcludedDirs(folder.uri.fsPath, [
					...WORKSPACE_GEO_EXCLUDED_DIRS,
					...merged.dirNames,
				])) {
					excluded.add(name)
					stats.foldersSkipped++
				}
				if (budget <= 0) {
					stats.truncated = true
					continue
				}
				const pattern = new vscode.RelativePattern(folder, GEO_GLOB)
				const uris = await vscode.workspace.findFiles(pattern, buildExcludeGlob(merged.globs), budget)
				budget -= uris.length
				if (budget <= 0) stats.truncated = true
				await this.judgeAll(uris, folder, found, stats)
			} catch (error) {
				console.error(`[FileScanner] Error scanning ${folder.name}:`, error)
			}
		}
		// A truncated scan lists exactly MAX_PROJECT_FILES; the extra one only proved there are more.
		const kept = [...found.entries()].sort((a, b) => a[1].relativePath.localeCompare(b[1].relativePath))
		if (kept.length > MAX_PROJECT_FILES) stats.truncated = true
		this.files = new Map(kept.slice(0, MAX_PROJECT_FILES))
		this.extraExcludedDirs = [...extraDirs]
		stats.skippedNames = [...excluded].sort()
		this.stats = stats
	}

	/** Names from `names` that exist as directories at the top of `folder`. */
	private async presentExcludedDirs(folder: string, names: readonly string[]): Promise<string[]> {
		const present: string[] = []
		for (const name of new Set(names)) {
			try {
				if ((await fs.stat(path.join(folder, name))).isDirectory()) present.push(name)
			} catch {
				/* not there */
			}
		}
		return present
	}

	/** Judge many files with bounded concurrency. */
	private async judgeAll(
		uris: readonly vscode.Uri[],
		folder: vscode.WorkspaceFolder,
		into: Map<string, WorkspaceGeoJsonFile>,
		stats: ScanStats,
	): Promise<void> {
		let next = 0
		const worker = async () => {
			while (next < uris.length) {
				const uri = uris[next++]
				const file = await this.judge(uri, folder, stats)
				if (file) into.set(uri.toString(), file)
			}
		}
		await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, uris.length) }, worker))
	}

	/** Decide whether one path is a listed map file. Reads at most a prefix. Returns the file, or undefined. */
	private async judge(
		uri: vscode.Uri,
		workspaceFolder: vscode.WorkspaceFolder,
		stats: ScanStats,
	): Promise<WorkspaceGeoJsonFile | undefined> {
		try {
			const extension = path.extname(uri.fsPath).toLowerCase()
			const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath)
			const name = path.basename(uri.fsPath)

			// The watcher glob is workspace-wide, so excluded directories must be re-checked here.
			if (isExcludedWorkspaceGeoPath(relativePath) || isExcludedByNames(relativePath, this.extraExcludedDirs)) {
				return undefined
			}
			// The tools' state directory is excluded only at the top of a folder: a user's own `.aihydro` deeper down is data.
			if (relativePath.split(path.sep)[0] === AIHYDRO_STATE_DIR) {
				return undefined
			}

			const lstat = await fs.lstat(uri.fsPath)
			if (lstat.isSymbolicLink()) {
				stats.symlinksFound++
				// A symlink that leaves the workspace folder is not a workspace file.
				if (!(await realPathInsideFolder(workspaceFolder.uri.fsPath, uri.fsPath))) {
					stats.symlinksSkipped++
					return undefined
				}
			}
			const stat = lstat.isSymbolicLink() ? await fs.stat(uri.fsPath) : lstat
			if (!stat.isFile()) {
				return undefined
			}

			if (JSON_TEXT.has(extension) && !looksLikeGeoJson(await readPrefix(uri.fsPath), stat.size, extension)) {
				return undefined
			}

			return {
				uri,
				workspaceFolder: workspaceFolder.uri.fsPath,
				workspaceFolderName: workspaceFolder.name,
				relativePath,
				name,
				extension,
				lastModified: stat.mtimeMs,
				sizeBytes: stat.size,
				requiresConversion: this.needsConversion(extension),
			}
		} catch (error) {
			console.warn(`[FileScanner] Error reading ${uri.fsPath}:`, error)
			return undefined
		}
	}

	/**
	 * Check if a file extension requires conversion to GeoJSON
	 */
	private needsConversion(extension: string): boolean {
		const ext = extension.toLowerCase()
		return [".kml", ".gpx", ".topojson", ".topo.json", ".fgb", ".shp", ".tif", ".tiff", ".kmz"].includes(ext)
	}

	/**
	 * Set up file system watcher for auto-refresh. Events are collected and handled together after a quiet period, so a
	 * tool writing 500 files costs one pass, not 500.
	 */
	private setupWatcher(): void {
		// biome-ignore lint/correctness/noNodejsModules: VSCode workspace API required for file watching
		this.watcher = vscode.workspace.createFileSystemWatcher(GEO_GLOB)
		const queue = (uri: vscode.Uri, present: boolean) => {
			this.pending.set(uri.toString(), { uri, present })
			if (this.batchTimer) clearTimeout(this.batchTimer)
			this.batchTimer = setTimeout(() => {
				this.batchTimer = null
				void this.flushPending()
			}, this.BATCH_MS)
		}
		const emit = (uri: vscode.Uri) => {
			for (const listener of this.fileEventListeners) {
				try {
					listener(uri.fsPath)
				} catch (error) {
					console.warn("[FileScanner] A file event listener failed:", error)
				}
			}
		}
		this.watcher.onDidCreate((uri) => {
			emit(uri)
			queue(uri, true)
		})
		this.watcher.onDidChange((uri) => {
			emit(uri)
			queue(uri, true)
		})
		this.watcher.onDidDelete((uri) => {
			emit(uri)
			queue(uri, false)
		})
		// A changed `files.exclude` changes which files exist for the list.
		this.configWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration("files.exclude")) this.refreshDebounced()
		})
	}

	private async flushPending(): Promise<void> {
		const batch = [...this.pending.values()]
		this.pending.clear()
		let changed = false
		let next = 0
		const worker = async () => {
			while (next < batch.length) {
				const { uri, present } = batch[next++]
				const key = uri.toString()
				if (!present) {
					changed = this.files.delete(key) || changed
					continue
				}
				// biome-ignore lint/correctness/noNodejsModules: VSCode workspace API required for folder lookup
				const folder = vscode.workspace.getWorkspaceFolder(uri)
				if (!folder) continue
				const file = await this.judge(uri, folder, this.stats)
				if (file) {
					this.files.set(key, file)
					changed = true
				} else {
					changed = this.files.delete(key) || changed
				}
			}
		}
		await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, batch.length) }, worker))
		if (changed) this.notifyChangesDebounced()
	}

	/** A full rescan after a quiet period (settings changes, many folders changing at once). */
	refreshDebounced(): void {
		if (this.batchTimer) clearTimeout(this.batchTimer)
		this.batchTimer = setTimeout(() => {
			this.batchTimer = null
			void this.refresh()
		}, this.BATCH_MS)
	}

	/**
	 * Notify changes with debouncing to avoid rapid updates
	 */
	private notifyChangesDebounced(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer)
		}

		this.debounceTimer = setTimeout(() => {
			this.notifyChanges()
			this.debounceTimer = null
		}, this.DEBOUNCE_MS)
	}

	/**
	 * Notify callback of file changes
	 */
	private notifyChanges(): void {
		if (this.onFilesChangedCallback) {
			const filesArray = Array.from(this.files.values())
			console.log(`[FileScanner] Notifying changes: ${filesArray.length} files`)
			this.onFilesChangedCallback(filesArray)
		}
	}

	/**
	 * Listen to every file event of the shared watcher (created, changed, removed), as it happens. Returns the way to stop.
	 * The events are not filtered: a listener decides which files matter to it.
	 */
	onFileEvent(listener: (file: string) => void): () => void {
		this.fileEventListeners.add(listener)
		return () => this.fileEventListeners.delete(listener)
	}

	/**
	 * Set callback for file changes
	 */
	onFilesChanged(callback: (files: WorkspaceGeoJsonFile[]) => void): void {
		this.onFilesChangedCallback = callback
	}

	/**
	 * Get current list of GeoJSON files
	 */
	getFiles(): WorkspaceGeoJsonFile[] {
		return Array.from(this.files.values())
	}

	/**
	 * Get count of files
	 */
	getFileCount(): number {
		return this.files.size
	}

	/**
	 * Manually refresh (rescan workspace)
	 */
	async refresh(): Promise<void> {
		const folders = vscode.workspace.workspaceFolders
		if (folders) {
			await this.scanWorkspace(folders)
			this.notifyChanges()
		}
	}

	/**
	 * Read GeoJSON content from a file
	 */
	async readGeoJson(file: WorkspaceGeoJsonFile): Promise<string> {
		// biome-ignore lint/correctness/noNodejsModules: VSCode workspace API required for file reading
		const content = await vscode.workspace.fs.readFile(file.uri)
		return Buffer.from(content).toString("utf8")
	}

	/**
	 * Dispose of resources
	 */
	dispose(): void {
		if (this.watcher) {
			this.watcher.dispose()
			this.watcher = null
		}
		this.configWatcher?.dispose()
		this.configWatcher = null
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer)
			this.debounceTimer = null
		}
		if (this.batchTimer) {
			clearTimeout(this.batchTimer)
			this.batchTimer = null
		}
		this.pending.clear()
		this.files.clear()
		this.fileEventListeners.clear()
		this.onFilesChangedCallback = null
		console.log("[FileScanner] Disposed")
	}
}
