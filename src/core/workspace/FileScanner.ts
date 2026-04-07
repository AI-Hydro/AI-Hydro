/**
 * Scans workspace for GeoJSON files and watches for changes
 */

import * as path from "path"
import * as vscode from "vscode"
import { isValidGeoJSONString } from "./GeoJsonValidator"

export interface WorkspaceGeoJsonFile {
	uri: vscode.Uri
	relativePath: string
	name: string
	extension: string
	lastModified: number
	requiresConversion: boolean
}

export class FileScanner {
	private watcher: vscode.FileSystemWatcher | null = null
	private files: Map<string, WorkspaceGeoJsonFile> = new Map()
	private onFilesChangedCallback: ((files: WorkspaceGeoJsonFile[]) => void) | null = null
	private debounceTimer: NodeJS.Timeout | null = null
	private readonly DEBOUNCE_MS = 500

	/**
	 * Initialize the file scanner
	 */
	async initialize(workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<void> {
		console.log("[FileScanner] Initializing...")

		// Initial scan
		await this.scanWorkspace(workspaceFolders)

		// Set up file watcher
		this.setupWatcher()

		console.log(`[FileScanner] Initialized with ${this.files.size} GeoJSON files`)
	}

	/**
	 * Scan workspace recursively for geo data files
	 */
	private async scanWorkspace(workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<void> {
		this.files.clear()

		for (const folder of workspaceFolders) {
			try {
				// Find all supported geo format files recursively
				// Includes: GeoJSON, KML, GPX, TopoJSON, FlatGeobuf, Shapefiles
				const pattern = new vscode.RelativePattern(folder, "**/*.{geojson,json,kml,gpx,topojson,topo.json,fgb,shp}")
				// biome-ignore lint/correctness/noNodejsModules: VSCode workspace API required for file scanning
				const uris = await vscode.workspace.findFiles(pattern, "**/node_modules/**")

				console.log(`[FileScanner] Found ${uris.length} potential geo data files in ${folder.name}`)

				// Validate each file
				for (const uri of uris) {
					await this.validateAndAddFile(uri, folder)
				}
			} catch (error) {
				console.error(`[FileScanner] Error scanning ${folder.name}:`, error)
			}
		}
	}

	/**
	 * Validate and add a file to the collection
	 */
	private async validateAndAddFile(uri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
		try {
			const extension = path.extname(uri.fsPath).toLowerCase()
			const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath)
			const name = path.basename(uri.fsPath)

			// Determine if file needs conversion
			const requiresConversion = this.needsConversion(extension)

			// For GeoJSON files, validate content
			if (!requiresConversion) {
				// biome-ignore lint/correctness/noNodejsModules: VSCode workspace API required for file operations
				const content = await vscode.workspace.fs.readFile(uri)
				const contentStr = Buffer.from(content).toString("utf8")

				// Validate GeoJSON
				const validation = isValidGeoJSONString(contentStr)

				if (!validation.valid) {
					console.log(`[FileScanner] Skipped (invalid GeoJSON): ${relativePath} - ${validation.error}`)
					return
				}
			}

			// Add file to collection
			// biome-ignore lint/correctness/noNodejsModules: VSCode workspace API required for file metadata
			const stat = await vscode.workspace.fs.stat(uri)

			const file: WorkspaceGeoJsonFile = {
				uri,
				relativePath,
				name,
				extension,
				lastModified: stat.mtime,
				requiresConversion,
			}

			this.files.set(uri.toString(), file)
			console.log(`[FileScanner] Added: ${relativePath} (${extension})${requiresConversion ? " [needs conversion]" : ""}`)
		} catch (error) {
			console.warn(`[FileScanner] Error reading ${uri.fsPath}:`, error)
		}
	}

	/**
	 * Check if a file extension requires conversion to GeoJSON
	 */
	private needsConversion(extension: string): boolean {
		const ext = extension.toLowerCase()
		return [".kml", ".gpx", ".topojson", ".topo.json", ".fgb", ".shp"].includes(ext)
	}

	/**
	 * Set up file system watcher for auto-refresh
	 */
	private setupWatcher(): void {
		// Watch for all supported geo format files
		// biome-ignore lint/correctness/noNodejsModules: VSCode workspace API required for file watching
		this.watcher = vscode.workspace.createFileSystemWatcher("**/*.{geojson,json,kml,gpx,topojson,topo.json,fgb,shp}")

		// File created
		this.watcher.onDidCreate(async (uri) => {
			console.log(`[FileScanner] File created: ${uri.fsPath}`)
			// biome-ignore lint/correctness/noNodejsModules: VSCode workspace API required for folder lookup
			const folder = vscode.workspace.getWorkspaceFolder(uri)
			if (folder) {
				await this.validateAndAddFile(uri, folder)
				this.notifyChangesDebounced()
			}
		})

		// File deleted
		this.watcher.onDidDelete((uri) => {
			console.log(`[FileScanner] File deleted: ${uri.fsPath}`)
			const removed = this.files.delete(uri.toString())
			if (removed) {
				this.notifyChangesDebounced()
			}
		})

		// File changed
		this.watcher.onDidChange(async (uri) => {
			console.log(`[FileScanner] File changed: ${uri.fsPath}`)
			// Remove and re-add to revalidate
			this.files.delete(uri.toString())
			// biome-ignore lint/correctness/noNodejsModules: VSCode workspace API required for folder lookup
			const folder = vscode.workspace.getWorkspaceFolder(uri)
			if (folder) {
				await this.validateAndAddFile(uri, folder)
				this.notifyChangesDebounced()
			}
		})

		console.log("[FileScanner] File watcher set up")
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
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer)
			this.debounceTimer = null
		}
		this.files.clear()
		this.onFilesChangedCallback = null
		console.log("[FileScanner] Disposed")
	}
}
