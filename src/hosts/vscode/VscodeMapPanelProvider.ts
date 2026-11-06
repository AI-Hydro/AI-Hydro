import * as crypto from "node:crypto"
import * as fsp from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { Controller } from "@core/controller"
import { authorizeMapPath, grantMapPath, type MapPathDeps, type MapPathPurpose } from "@core/map/authorizeMapPath"
import { writeDerivedGeojson } from "@core/map/derivedWrite"
import { handleMapAgentTaskMessage } from "@core/map/handleMapAgentTask"
import { MapFileWatch, type ParseResult, type WatchReport } from "@core/map/mapFileWatch"
import { checkProjectFileRequest } from "@core/map/projectFiles"
import { resolveMapFilePath as resolveMapFilePathIn } from "@core/map/resolveMapFilePath"
import { checkSaveTarget, loadPinsForProject, NO_FOLDER_KEY, quarantinePins, savePinsForProject } from "@core/project/pinStore"
import { dirProjectKey, getProjectKey, type ProjectKey, type ProjectKeyHub } from "@core/project/projectIdentity"
import { aihydroPath } from "@shared/aihydro/aihydroHome"
import { resolvedSourcePath } from "@shared/map/layerIdentity"
import axios from "axios"
import * as vscode from "vscode"
import { AiHydroEnv } from "@/config"
import { GeeService } from "@/services/gee/GeeService"
import { GeeTileProxyService } from "@/services/gee/GeeTileProxyService"
import { buildGeeMapLayer } from "@/services/gee/mapMessageHandler"
import { geeCommandSchema, geePreviewChirpsPayloadSchema, geeStatusPayloadSchema } from "@/services/gee/schemas"
import type { GeeProjectInfo, GeeStatusResult } from "@/services/gee/types"
import { handleHydroMapCommand } from "@/services/hydrology/handleHydroMapCommand"
import { MarketplaceRecognitionService } from "@/services/recognition/MarketplaceRecognitionService"
import { validReplayIds } from "./replayIds"

/** The file a layer's path names. A project path is never answered with a cache copy (see `resolveMapFilePath`). */
function resolveMapFilePath(filePath: string, hint: { workspaceFolder?: unknown; kind?: unknown } = {}): Promise<string> {
	return resolveMapFilePathIn(
		filePath,
		{
			homedir: os.homedir(),
			workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
			cacheDirs: [aihydroPath("map_layer_geojson_cache"), aihydroPath()],
			exists: async (candidate) => {
				try {
					await vscode.workspace.fs.stat(vscode.Uri.file(candidate))
					return true
				} catch {
					return false
				}
			},
		},
		{
			workspaceFolder: typeof hint.workspaceFolder === "string" ? hint.workspaceFolder : undefined,
			kind: hint.kind === "project" || hint.kind === "cache" ? hint.kind : "any",
		},
	)
}

/**
 * The one check every path from the webview, a scene or a message passes before the host opens it, reads it or adds its
 * folder to the panel's resource roots (see `authorizeMapPath`).
 */
async function authorizeForMap(
	absolutePath: string,
	purpose: MapPathPurpose,
	controller: Controller | undefined,
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
	const deps: MapPathDeps = {
		workspaceFolders: () => (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
		aihydroDirs: () => [aihydroPath("map_layer_geojson_cache"), aihydroPath()],
		onMapPaths: () =>
			(controller?.getMapLayers() ?? []).map((layer) => resolvedSourcePath(layer.metadata)).filter((p): p is string => !!p),
	}
	return await authorizeMapPath(absolutePath, purpose, deps)
}

const MAP_SUPPORTED_EXTENSIONS = new Set([
	".geojson",
	".json",
	".topojson",
	".kml",
	".kmz",
	".gpx",
	".zip",
	".tif",
	".tiff",
	".csv",
])

const extensionFromUrl = (url: string): string => {
	try {
		return path.extname(new URL(url).pathname).toLowerCase()
	} catch {
		return path.extname(url).toLowerCase()
	}
}

const safeFilename = (value: string, fallback = "map-layer"): string => {
	const cleaned = value
		.replace(/[?#].*$/, "")
		.split("/")
		.pop()
		?.replace(/[^a-zA-Z0-9._-]+/g, "_")
		.replace(/^_+|_+$/g, "")
	return cleaned || fallback
}

const checksum = (bytes: Uint8Array | string): string => crypto.createHash("sha256").update(bytes).digest("hex")

type ResearchGalleryItemType = "map_scene" | "style_preset" | "case_study" | "dataset_connector" | "map_plate_template"
type ResearchGalleryTrustLevel = "official" | "reviewed" | "community" | "local"

interface ResearchGalleryItem {
	id: string
	type: ResearchGalleryItemType
	title: string
	description: string
	version: string
	author: string
	license: string
	trustLevel: ResearchGalleryTrustLevel
	tags: string[]
	thumbnailUrl?: string
	githubUrl?: string
	artifactUrl?: string
	citation: string
	citationUrl?: string
	authorUrl?: string
	createdAt?: string
	updatedAt?: string
	isFeatured?: boolean
	isInstalled?: boolean
	downloadCount?: number
	aiHydroStars?: number
	starredByClient?: boolean
	contributors?: Array<Record<string, unknown>>
	badges?: string[]
	metrics?: Record<string, unknown>
	discussionUrl?: string
	source?: "remote" | "built_in" | "local"
	importWarnings?: string[]
}

const builtInResearchGalleryArtifacts: Record<string, { fileName: string; content: string }> = {
	"fallback-watershed-scene": {
		fileName: "aihydro_gallery_sample_watershed.geojson",
		content: JSON.stringify({
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					properties: { name: "Sample watershed", area_km2: 128.4, source: "AI-Hydro Research Gallery" },
					geometry: {
						type: "Polygon",
						coordinates: [
							[
								[-86.96, 39.74],
								[-86.72, 39.84],
								[-86.52, 39.69],
								[-86.56, 39.48],
								[-86.82, 39.42],
								[-87.02, 39.56],
								[-86.96, 39.74],
							],
						],
					},
				},
			],
		}),
	},
}

const builtInResearchGalleryItems: ResearchGalleryItem[] = [
	{
		id: "fallback-watershed-scene",
		type: "map_scene",
		title: "Offline fallback watershed scene",
		description: "A tiny built-in watershed polygon shown only when the remote AI-Hydro Research Gallery cannot be reached.",
		version: "0.1.0",
		author: "AI-Hydro Team",
		authorUrl: "https://github.com/AI-Hydro",
		license: "AI-Hydro example data",
		trustLevel: "official",
		tags: ["watershed", "scene", "geojson", "example"],
		artifactUrl: "aihydro-gallery://fallback-watershed-scene",
		citation: "AI-Hydro Research Gallery official example.",
		citationUrl: "https://github.com/AI-Hydro/Gallery",
		source: "built_in",
	},
]

function geeNeedsProject(result: GeeStatusResult): boolean {
	const text = `${result.message ?? ""}\n${result.error ?? ""}`.toLowerCase()
	return text.includes("project") && (text.includes("registered") || text.includes("serviceusage"))
}

async function promptForGeeProjectAndRetry(operation: "connect" | "status", result: GeeStatusResult): Promise<GeeStatusResult> {
	if (!geeNeedsProject(result)) {
		return result
	}
	const projectId = await chooseGeeProject()
	if (!projectId) {
		return result
	}
	return operation === "connect" ? GeeService.connect(projectId) : GeeService.status(projectId)
}

async function chooseGeeProject(): Promise<string | undefined> {
	const projectsResult = await GeeService.listProjects()
	if (!projectsResult.ok || (projectsResult.projects ?? []).length === 0) {
		const projectId = await vscode.window.showInputBox({
			title: "AI-Hydro: Google Earth Engine Project",
			prompt: `${projectsResult.message} Enter a Google Cloud project ID registered for Earth Engine.`,
			placeHolder: "my-earthengine-project",
			ignoreFocusOut: true,
			validateInput: (value) => (value.trim().length < 3 ? "Enter a valid Google Cloud project ID." : undefined),
		})
		if (!projectId) {
			return undefined
		}
		await vscode.workspace
			.getConfiguration("aihydro.gee")
			.update("projectId", projectId.trim(), vscode.ConfigurationTarget.Global)
		await GeeService.setProject(projectId.trim())
		return projectId.trim()
	}

	const manualItem = {
		label: "$(edit) Enter project ID manually",
		description: "Type your project ID manually",
		project: undefined as GeeProjectInfo | undefined,
	}
	const items = [
		...(projectsResult.projects ?? []).map((project) => ({
			label: project.project_id,
			description: project.name,
			detail: project.project_number ? `Project number: ${project.project_number}` : undefined,
			project,
		})),
		manualItem,
	]
	const selected = await vscode.window.showQuickPick(items, {
		title: "AI-Hydro: Select Google Earth Engine Project",
		placeHolder: "Choose a Google Cloud project registered for Earth Engine",
		ignoreFocusOut: true,
	})
	if (!selected) {
		return undefined
	}
	let projectId = selected.project?.project_id
	if (!projectId) {
		projectId = await vscode.window.showInputBox({
			title: "AI-Hydro: Google Earth Engine Project",
			prompt: "Enter a Google Cloud project ID registered for Earth Engine. AI-Hydro will save it to settings.",
			placeHolder: "my-earthengine-project",
			ignoreFocusOut: true,
			validateInput: (value) => (value.trim().length < 3 ? "Enter a valid Google Cloud project ID." : undefined),
		})
	}
	if (!projectId) {
		return undefined
	}
	await vscode.workspace
		.getConfiguration("aihydro.gee")
		.update("projectId", projectId.trim(), vscode.ConfigurationTarget.Global)
	await GeeService.setProject(projectId.trim())
	return projectId.trim()
}

export class VscodeMapPanelProvider {
	private static currentPanel: vscode.WebviewPanel | undefined
	private static context: vscode.ExtensionContext
	private static controller: Controller | undefined
	private static disposables: vscode.Disposable[] = []

	public static initialize(context: vscode.ExtensionContext, controller: Controller) {
		VscodeMapPanelProvider.context = context
		VscodeMapPanelProvider.controller = controller
		VscodeMapPanelProvider.startFileWatch(context, controller)
	}

	private static fileWatch: MapFileWatch | undefined
	/** True once the current panel's page has said it is listening (`aihydro-map-panel-ready`). */
	private static pageReady = false
	private static fileWatchSync: ReturnType<typeof setTimeout> | undefined

	/**
	 * A layer that names a file follows the file (see `MapFileWatch`). The watcher lives as long as the extension, not the
	 * panel: a file can change while the map is closed, and the next open finds it. It never opens or reveals the panel.
	 */
	private static startFileWatch(context: vscode.ExtensionContext, controller: Controller): void {
		VscodeMapPanelProvider.fileWatch?.dispose()
		const watch = new MapFileWatch({
			layers: () => controller.getMapLayers(),
			fs: {
				stat: async (p) => {
					const st = await fsp.stat(p)
					return { size: st.size, mtimeMs: st.mtimeMs }
				},
				readFile: (p) => fsp.readFile(p),
			},
			// "load", not "read": a path a map scene or a message put on a layer is not a file the map was allowed to open.
			authorize: async (p) => {
				const decision = await authorizeForMap(p, "load", controller)
				return decision.ok ? decision.path : undefined
			},
			workspaceFolders: () => (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
			watchFolder: (folder, onEvent) => {
				try {
					// A plain `*` pattern on a base folder is a non-recursive watch, inside the workspace or outside it.
					const watcher = vscode.workspace.createFileSystemWatcher(
						new vscode.RelativePattern(vscode.Uri.file(folder), "*"),
					)
					watcher.onDidCreate((uri) => onEvent(uri.fsPath))
					watcher.onDidChange((uri) => onEvent(uri.fsPath))
					watcher.onDidDelete((uri) => onEvent(uri.fsPath))
					return watcher
				} catch (err) {
					console.warn(`[VscodeMapPanelProvider] Could not watch ${folder}:`, err)
					return undefined
				}
			},
			onWorkspaceEvent: (listener) => ({ dispose: controller.onWorkspaceFileEvent(listener) }),
			// A panel whose page is not listening yet cannot take a request, so it counts as not open until it says it is ready.
			panelOpen: () => VscodeMapPanelProvider.currentPanel !== undefined && VscodeMapPanelProvider.pageReady,
			requestParse: (request) => {
				const panel = VscodeMapPanelProvider.currentPanel
				if (!panel) {
					return false
				}
				const uri = vscode.Uri.file(request.path)
				VscodeMapPanelProvider.allowLocalFileRoots(panel, [vscode.Uri.file(path.dirname(request.path))])
				void panel.webview.postMessage({
					type: "aihydro-map-refresh-file",
					...request,
					uri: panel.webview.asWebviewUri(uri).toString(),
				})
				return true
			},
			patchLayer: (layerId, metadata) => {
				controller.updateMapLayer(layerId, { metadata })
			},
			applyRefresh: (layerId, update, mode) => controller.refreshMapLayerFromFile(layerId, update, mode),
			report: (report) => VscodeMapPanelProvider.postFileStatus(report),
		})
		VscodeMapPanelProvider.fileWatch = watch
		watch.start()
		const scheduleSync = () => {
			if (VscodeMapPanelProvider.fileWatchSync) {
				clearTimeout(VscodeMapPanelProvider.fileWatchSync)
			}
			VscodeMapPanelProvider.fileWatchSync = setTimeout(() => {
				VscodeMapPanelProvider.fileWatchSync = undefined
				void watch.sync()
			}, 200)
		}
		const unsubscribe = controller.subscribeToMapLayerUpdates(scheduleSync)
		// Layers come back from the catalog a few at a time. Once they are all here, every file is looked at once.
		void controller.whenMapRestored().then(() => watch.checkAll())
		context.subscriptions.push({
			dispose: () => {
				unsubscribe()
				if (VscodeMapPanelProvider.fileWatchSync) {
					clearTimeout(VscodeMapPanelProvider.fileWatchSync)
				}
				watch.dispose()
				if (VscodeMapPanelProvider.fileWatch === watch) {
					VscodeMapPanelProvider.fileWatch = undefined
				}
			},
		})
	}

	/** What the watcher did, said in the panel's status line. Posted only to a panel that exists. */
	private static postFileStatus(report: WatchReport): void {
		const panel = VscodeMapPanelProvider.currentPanel
		if (!panel) {
			return
		}
		let message: string
		let kind: "ok" | "err" = "ok"
		switch (report.kind) {
			case "updated":
				message =
					report.mode === "use_new_file"
						? `Now using the new file for ${report.name}.${report.priorRun ? ` The link to run ${report.priorRun.slice(-8)} was removed.` : ""}`
						: `Updated ${report.name}: the file changed on disk.`
				break
			case "flagged":
				message = `The file behind ${report.name} changed. The layer is linked to a run, so it was not changed.`
				break
			case "unreadable":
				message = `Could not read the new version of ${report.name}: ${report.reason}. Showing the last good copy.`
				kind = "err"
				break
			case "watch_limit":
				message = `Watching the first ${report.limit} folders. Files in other folders are found when the map is shown again.`
				break
			case "missing":
				message = `File not found for ${report.name}. Showing the last loaded copy.`
				kind = "err"
				break
		}
		void panel.webview.postMessage({ type: "aihydro-map-file-status", kind, message })
	}

	/** Pin bucket keys per workspace root. A lookup that fell back to `dir:` is retried, so a project that gets an id later is picked up. */
	private static pinKeys = new Map<string, ProjectKey>()
	/** Pin saves run through this chain, so they reach disk in the order they were sent. */
	private static pinSaveQueue: Promise<void> = Promise.resolve()

	/**
	 * Which project's pins the map shows: the first workspace folder's project key (`prj_...` when the tools server knows
	 * it, `dir:` otherwise), plus the folder's `dir:` key so a bucket saved before the project had an id can follow it.
	 * With no folder open there is one shared "no folder" bucket.
	 */
	private static async pinProjectKeys(): Promise<{ key: ProjectKey; dirKey?: string }> {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (!root) {
			return { key: { key: NO_FOLDER_KEY, kind: "dir" } }
		}
		const cached = VscodeMapPanelProvider.pinKeys.get(root)
		if (cached?.kind === "prj") {
			return { key: cached, dirKey: await dirProjectKey(root) }
		}
		const hub = VscodeMapPanelProvider.controller?.mcpHub as unknown as ProjectKeyHub | undefined
		const key = await getProjectKey(root, hub)
		VscodeMapPanelProvider.pinKeys.set(root, key)
		return { key, dirKey: await dirProjectKey(root) }
	}

	/** Returns true if the map panel is currently open (even if not visible). */
	public static isOpen(): boolean {
		return VscodeMapPanelProvider.currentPanel !== undefined
	}

	/**
	 * Send raw file bytes to the map webview for client-side parsing.
	 * Opens the panel first if it's not already visible.
	 * Kept for small legacy callers. Prefer sendFileUrisToMap for workspace files,
	 * especially binary rasters, to avoid JSON-serializing large byte arrays.
	 */
	public static async sendFilesToMap(files: Array<{ name: string; data: Uint8Array }>): Promise<void> {
		await VscodeMapPanelProvider.createOrShow()
		const panel = VscodeMapPanelProvider.currentPanel
		if (!panel) {
			return
		}
		// Small delay to let the webview finish mounting before we push data
		await new Promise((resolve) => setTimeout(resolve, 400))
		for (const file of files) {
			await panel.webview.postMessage({
				type: "aihydro-load-file",
				name: file.name,
				// Transfer as plain number array so JSON serialization works
				data: Array.from(file.data),
			})
		}
	}

	/**
	 * Send file references to the map webview. The webview fetches each URI as
	 * a Blob and parses it client-side, avoiding the huge number[] payload that
	 * can crash VS Code/webview when loading GeoTIFFs from the file prompt.
	 */
	public static async sendFileUrisToMap(
		uris: vscode.Uri[],
		sourceExtras: Record<string, Record<string, string | number | undefined>> = {},
	): Promise<void> {
		await VscodeMapPanelProvider.createOrShow()
		const panel = VscodeMapPanelProvider.currentPanel
		if (!panel) {
			return
		}
		// A path the check refuses is not loaded. Files the user picked were granted by `grantAndSendFileUrisToMap`. What is
		// read, served and recorded is the path the check resolved, not the spelling it was asked with.
		const allowed: { uri: vscode.Uri; asked: string }[] = []
		for (const asked of uris) {
			const decision = await authorizeForMap(asked.fsPath, "load", VscodeMapPanelProvider.controller)
			if (decision.ok) {
				allowed.push({ uri: vscode.Uri.file(decision.path), asked: asked.fsPath })
			} else {
				vscode.window.showWarningMessage(`AI-Hydro Map: ${decision.reason}`)
			}
		}
		VscodeMapPanelProvider.allowLocalFileRoots(
			panel,
			allowed.map(({ uri }) => vscode.Uri.file(path.dirname(uri.fsPath))),
		)
		await new Promise((resolve) => setTimeout(resolve, 400))
		for (const { uri, asked } of allowed) {
			let stat: vscode.FileStat | undefined
			try {
				stat = await vscode.workspace.fs.stat(uri)
			} catch {
				/* ignore */
			}
			await panel.webview.postMessage({
				type: "aihydro-load-file-uri",
				name: path.basename(uri.fsPath),
				uri: panel.webview.asWebviewUri(uri).toString(),
				sourcePath: uri.fsPath,
				sourceUri: uri.toString(),
				sourceMtimeMs: stat?.mtime,
				sourceSizeBytes: stat?.size,
				...(sourceExtras[asked] ?? sourceExtras[uri.fsPath] ?? {}),
			})
		}
	}

	/** For files the user just chose (Add file, the Explorer menu, "Add to Map"): the choice puts them in reach of the map. */
	public static async grantAndSendFileUrisToMap(
		uris: vscode.Uri[],
		sourceExtras: Record<string, Record<string, string | number | undefined>> = {},
	): Promise<void> {
		for (const uri of uris) {
			grantMapPath(uri.fsPath)
		}
		await VscodeMapPanelProvider.sendFileUrisToMap(uris, sourceExtras)
	}

	/**
	 * Add file: the native picker, so every file that reaches the map this way carries its absolute path (the webview's
	 * own file input cannot tell the page where the file is). Same route as the Explorer menu.
	 */
	public static async addFilesFromDialog(): Promise<void> {
		const picked = await vscode.window.showOpenDialog({
			title: "AI-Hydro Map: Add File",
			canSelectMany: true,
			defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
			filters: {
				"Map files": Array.from(MAP_SUPPORTED_EXTENSIONS).map((ext) => ext.slice(1)),
			},
		})
		if (!picked || picked.length === 0) {
			return
		}
		await VscodeMapPanelProvider.grantAndSendFileUrisToMap(picked)
	}

	public static async addLayerFromUrl(initialUrl?: string): Promise<void> {
		if (!VscodeMapPanelProvider.context) {
			vscode.window.showWarningMessage("AI-Hydro Map is not ready yet.")
			return
		}
		const url =
			initialUrl ??
			(await vscode.window.showInputBox({
				title: "AI-Hydro Map: Add Layer from URL",
				prompt: "Paste a public GeoJSON, TopoJSON, KML, GPX, CSV, zipped shapefile, or GeoTIFF URL.",
				placeHolder: "https://example.org/layer.geojson",
				ignoreFocusOut: true,
				validateInput: (value) => {
					const trimmed = value.trim()
					if (!/^https?:\/\//i.test(trimmed)) {
						return "Enter an http(s) URL."
					}
					const ext = extensionFromUrl(trimmed)
					if (ext && !MAP_SUPPORTED_EXTENSIONS.has(ext)) {
						return `.${ext.replace(/^\./, "")} is not a supported map layer type yet.`
					}
					return undefined
				},
			}))
		if (!url) {
			return
		}
		const trimmedUrl = url.trim()
		const response = await fetch(trimmedUrl)
		if (!response.ok) {
			vscode.window.showErrorMessage(`AI-Hydro Map: URL failed with HTTP ${response.status}.`)
			return
		}
		const bytes = new Uint8Array(await response.arrayBuffer())
		const ext = extensionFromUrl(trimmedUrl) || ".geojson"
		const name = safeFilename(trimmedUrl, `remote_layer${ext}`)
		const cacheDir = vscode.Uri.joinPath(VscodeMapPanelProvider.context.globalStorageUri, "map-url-cache")
		await vscode.workspace.fs.createDirectory(cacheDir)
		const target = vscode.Uri.joinPath(cacheDir, `${Date.now()}_${name}`)
		await vscode.workspace.fs.writeFile(target, bytes)
		await VscodeMapPanelProvider.grantAndSendFileUrisToMap([target], {
			[target.fsPath]: {
				sourceRemoteUrl: trimmedUrl,
				sourceDisplayPath: trimmedUrl,
			},
		})
		vscode.window.showInformationMessage(`AI-Hydro Map: Added ${name} from URL.`)
	}

	public static async openMapGallery(): Promise<void> {
		if (!VscodeMapPanelProvider.context) {
			vscode.window.showWarningMessage("AI-Hydro Map is not ready yet.")
			return
		}
		await VscodeMapPanelProvider.createOrShow()
		await VscodeMapPanelProvider.currentPanel?.webview.postMessage({
			type: "aihydro-open-research-gallery",
		})
	}

	private static normalizeResearchGalleryItem(item: any, source: "remote" | "built_in" | "local"): ResearchGalleryItem {
		const id = String(item.id || item.galleryId || "")
		const rawType = String(item.type || "dataset_connector")
		const validTypes = new Set<ResearchGalleryItemType>([
			"map_scene",
			"style_preset",
			"dataset_connector",
			"case_study",
			"map_plate_template",
		])
		const type = validTypes.has(rawType as ResearchGalleryItemType)
			? (rawType as ResearchGalleryItemType)
			: "dataset_connector"
		const rawTrust = String(
			item.trustLevel || item.trust_level || item.trust || (source === "built_in" ? "official" : "community"),
		)
		const validTrust = new Set<ResearchGalleryTrustLevel>(["official", "reviewed", "community", "local"])
		const trustLevel = validTrust.has(rawTrust as ResearchGalleryTrustLevel)
			? (rawTrust as ResearchGalleryTrustLevel)
			: "community"
		return {
			id,
			type,
			title: String(item.title || item.name || id || "Untitled gallery item"),
			description: String(item.description || ""),
			version: String(item.version || "0.1.0"),
			author: String(item.author || "Unknown"),
			license: String(item.license || ""),
			trustLevel,
			tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
			thumbnailUrl: item.thumbnailUrl || item.thumbnail_url || "",
			githubUrl: item.githubUrl || item.github_url || "",
			artifactUrl: item.artifactUrl || item.artifact_url || item.downloadUrl || item.download_url || "",
			citation: typeof item.citation === "string" ? item.citation : item.citation?.text || "",
			citationUrl:
				item.citationUrl ||
				item.citation_url ||
				item.citation?.url ||
				(item.citation?.doi ? `https://doi.org/${String(item.citation.doi).replace(/^https?:\/\/doi\.org\//, "")}` : ""),
			authorUrl: item.authorUrl || item.author_url || item.authorProfileUrl || item.author_profile_url || "",
			createdAt: item.createdAt || item.created_at || "",
			updatedAt: item.updatedAt || item.updated_at || "",
			isFeatured: Boolean(item.isFeatured ?? item.is_featured ?? false),
			isInstalled: Boolean(item.isInstalled ?? item.is_installed ?? false),
			downloadCount: Number(item.downloadCount ?? item.download_count ?? 0),
			aiHydroStars: Number(item.aiHydroStars ?? item.ai_hydro_stars ?? item.metrics?.aiHydroStars ?? 0),
			starredByClient: Boolean(item.starredByClient ?? item.starred_by_client ?? false),
			contributors: Array.isArray(item.contributors) ? item.contributors : [],
			badges: Array.isArray(item.badges) ? item.badges.map(String) : [],
			metrics: item.metrics && typeof item.metrics === "object" ? item.metrics : {},
			discussionUrl: item.discussionUrl || item.discussion_url || "",
			source,
			importWarnings: Array.isArray(item.importWarnings ?? item.import_warnings)
				? (item.importWarnings ?? item.import_warnings).map(String)
				: [],
		}
	}

	private static async fetchResearchGalleryCatalog(): Promise<{
		items: ResearchGalleryItem[]
		sourceUrl: string
		warning?: string
	}> {
		const configuredUrl = `${AiHydroEnv.config().researchGalleryBaseUrl}/gallery.json`
		const fallbackUrl = "https://raw.githubusercontent.com/AI-Hydro/Gallery/main/api/gallery.json"
		const candidateUrls = Array.from(new Set([configuredUrl, fallbackUrl]))
		let lastError: unknown
		try {
			for (const sourceUrl of candidateUrls) {
				try {
					const response = await axios.get(sourceUrl, {
						headers: { "Content-Type": "application/json", "User-Agent": "aihydro-vscode-extension" },
						timeout: 10_000,
					})
					const rawItems: any[] = Array.isArray(response.data)
						? response.data
						: Array.isArray(response.data?.items)
							? response.data.items
							: []
					const remoteItems = rawItems
						.map((item) => VscodeMapPanelProvider.normalizeResearchGalleryItem(item, "remote"))
						.filter((item) => item.id && item.title)
					const recognitionCounts = await MarketplaceRecognitionService.getCounts("gallery")
					for (const item of remoteItems) {
						const counts = recognitionCounts.get(item.id)
						if (!counts) continue
						const imports = Number(counts.events.import ?? 0)
						const templateOpens = Number(counts.events.template_open ?? 0)
						const aiHydroStars = Number(counts.aiHydroStars ?? counts.events.star ?? 0)
						item.metrics = {
							...(item.metrics ?? {}),
							installs: imports + templateOpens,
							imports,
							templateOpens,
							aiHydroStars,
						}
						item.downloadCount = imports + templateOpens
						item.aiHydroStars = aiHydroStars
						item.starredByClient = counts.starredByClient
					}
					return {
						items: remoteItems,
						sourceUrl,
						warning:
							sourceUrl !== configuredUrl
								? `GitHub Pages catalog is not available yet; using the live raw GitHub catalog.`
								: undefined,
					}
				} catch (err) {
					lastError = err
				}
			}
			throw lastError
		} catch (err) {
			return {
				items: builtInResearchGalleryItems,
				sourceUrl: configuredUrl,
				warning: `Remote catalog unavailable; showing built-in official seed items. ${err instanceof Error ? err.message : String(err)}`,
			}
		}
	}

	private static async setResearchGalleryStar(panel: vscode.WebviewPanel, requestId: string, itemId: string, starred: boolean) {
		try {
			const result = await MarketplaceRecognitionService.setStar("gallery", itemId, starred)
			await panel.webview.postMessage({
				type: "aihydro-research-gallery-star-result",
				requestId,
				ok: true,
				itemId: result.itemId,
				starred: result.starred,
				aiHydroStars: result.aiHydroStars,
			})
		} catch (err) {
			await panel.webview.postMessage({
				type: "aihydro-research-gallery-star-result",
				requestId,
				ok: false,
				itemId,
				error: err instanceof Error ? err.message : String(err),
			})
		}
	}

	private static async importResearchGalleryItem(panel: vscode.WebviewPanel, requestId: string, item: ResearchGalleryItem) {
		try {
			if (!VscodeMapPanelProvider.context) {
				throw new Error("AI-Hydro Map is not ready yet.")
			}
			if (item.type === "map_plate_template") {
				void MarketplaceRecognitionService.recordEvent({
					marketplace: "gallery",
					itemId: item.id,
					eventType: "template_open",
					itemType: item.type,
					itemVersion: item.version,
					source: "ui",
				})
				await panel.webview.postMessage({
					type: "aihydro-open-export-panel",
				})
				await panel.webview.postMessage({
					type: "aihydro-research-gallery-import-result",
					requestId,
					ok: true,
					openExport: true,
					message: `Opened Research Plate Export for ${item.title}. Template-specific presets will be attached when template manifests are available.`,
				})
				return
			}

			const artifact = builtInResearchGalleryArtifacts[item.id]
			const artifactUrl = item.artifactUrl ?? ""
			let fileName = artifact?.fileName || safeFilename(artifactUrl, `${item.id}.geojson`)
			let bytes: Uint8Array
			if (artifact) {
				bytes = Buffer.from(artifact.content, "utf8")
			} else {
				if (!/^https?:\/\//i.test(artifactUrl)) {
					throw new Error("Gallery item does not provide an importable artifact URL.")
				}
				const response = await axios.get(artifactUrl, { responseType: "arraybuffer", timeout: 30_000 })
				bytes = new Uint8Array(response.data)
				fileName = safeFilename(artifactUrl, fileName)
			}

			const galleryDir = vscode.Uri.joinPath(VscodeMapPanelProvider.context.globalStorageUri, "research-gallery", item.id)
			await vscode.workspace.fs.createDirectory(galleryDir)
			const target = vscode.Uri.joinPath(galleryDir, fileName)
			await vscode.workspace.fs.writeFile(target, bytes)

			const text = Buffer.from(bytes).toString("utf8")
			const parsed = (() => {
				try {
					return JSON.parse(text)
				} catch {
					return undefined
				}
			})()
			if (parsed?.artifactType === "ai-hydro.map-scene") {
				await panel.webview.postMessage({
					type: "aihydro-open-map-scene",
					name: fileName,
					scene: text,
				})
			} else {
				await VscodeMapPanelProvider.grantAndSendFileUrisToMap([target], {
					[target.fsPath]: {
						sourceRemoteUrl: artifactUrl || `aihydro-gallery://${item.id}`,
						sourceDisplayPath: `AI-Hydro Research Gallery: ${item.title}`,
					},
				})
			}

			await panel.webview.postMessage({
				type: "aihydro-research-gallery-import-result",
				requestId,
				ok: true,
				message: `Imported ${item.title} from Research Gallery.`,
				itemId: item.id,
				path: target.fsPath,
				sha256: checksum(bytes),
			})
			void MarketplaceRecognitionService.recordEvent({
				marketplace: "gallery",
				itemId: item.id,
				eventType: "import",
				itemType: item.type,
				itemVersion: item.version,
				source: "ui",
			})
		} catch (err) {
			await panel.webview.postMessage({
				type: "aihydro-research-gallery-import-result",
				requestId,
				ok: false,
				error: err instanceof Error ? err.message : String(err),
				itemId: item?.id,
			})
		}
	}

	private static async postResearchGalleryCatalog(panel: vscode.WebviewPanel, requestId: string) {
		try {
			const catalog = await VscodeMapPanelProvider.fetchResearchGalleryCatalog()
			await panel.webview.postMessage({
				type: "aihydro-research-gallery-catalog-result",
				requestId,
				ok: true,
				items: catalog.items,
				sourceUrl: catalog.sourceUrl,
				warning: catalog.warning,
			})
		} catch (err) {
			await panel.webview.postMessage({
				type: "aihydro-research-gallery-catalog-result",
				requestId,
				ok: false,
				error: err instanceof Error ? err.message : String(err),
			})
		}
	}

	private static async openExternalUrl(url: string): Promise<void> {
		if (!/^https?:\/\//i.test(url)) {
			vscode.window.showWarningMessage("AI-Hydro Map: only http(s) URLs can be opened externally.")
			return
		}
		await vscode.env.openExternal(vscode.Uri.parse(url))
	}

	public static async requestSaveMapScene(): Promise<void> {
		await VscodeMapPanelProvider.createOrShow()
		await VscodeMapPanelProvider.currentPanel?.webview.postMessage({
			type: "aihydro-map-save-scene-request",
		})
	}

	public static async openMapScene(): Promise<void> {
		await VscodeMapPanelProvider.createOrShow()
		const picked = await vscode.window.showOpenDialog({
			title: "AI-Hydro Map: Open Scene",
			canSelectMany: false,
			filters: { "AI-Hydro Map Scene": ["aihydro-map.json", "json"] },
		})
		const uri = picked?.[0]
		if (!uri) {
			return
		}
		const bytes = await vscode.workspace.fs.readFile(uri)
		await VscodeMapPanelProvider.currentPanel?.webview.postMessage({
			type: "aihydro-open-map-scene",
			name: path.basename(uri.fsPath),
			scene: Buffer.from(bytes).toString("utf8"),
		})
	}

	private static allowLocalFileRoots(panel: vscode.WebviewPanel, roots: vscode.Uri[]): void {
		const existing = panel.webview.options.localResourceRoots ?? []
		const next = [...existing]
		const seen = new Set(existing.map((uri) => uri.toString()))
		for (const root of roots) {
			const key = root.toString()
			if (!seen.has(key)) {
				seen.add(key)
				next.push(root)
			}
		}
		panel.webview.options = {
			...panel.webview.options,
			localResourceRoots: next,
		}
	}

	/** True when a map tab exists in any editor group, including one this provider does not hold (restored by VS Code). */
	public static hasMapTab(): boolean {
		if (VscodeMapPanelProvider.currentPanel) {
			return true
		}
		return vscode.window.tabGroups.all.some((group) =>
			group.tabs.some(
				(tab) => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith("aihydroMapView"),
			),
		)
	}

	/** `preserveFocus` keeps the keyboard where it is (the chat), for opens the user did not ask for. */
	public static async createOrShow(options: { preserveFocus?: boolean } = {}) {
		if (!VscodeMapPanelProvider.context) {
			console.warn("[VscodeMapPanelProvider] Not yet initialized — cannot open map panel")
			return
		}

		const column = vscode.ViewColumn.Two

		// If we already have a panel, show it
		if (VscodeMapPanelProvider.currentPanel) {
			VscodeMapPanelProvider.currentPanel.reveal(column, options.preserveFocus)
			return
		}

		// Otherwise, create a new panel
		const workspaceRoots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? []
		const panel = vscode.window.createWebviewPanel(
			"aihydroMapView",
			"AI-Hydro Map",
			{ viewColumn: column, preserveFocus: options.preserveFocus },
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.joinPath(VscodeMapPanelProvider.context.extensionUri, "webview-ui", "build"),
					...workspaceRoots,
				],
			},
		)

		VscodeMapPanelProvider.currentPanel = panel
		VscodeMapPanelProvider.pageReady = false

		// Set the webview's HTML content
		panel.webview.html = VscodeMapPanelProvider.getHtmlForWebview(panel.webview)

		// CRITICAL: Set up message handler so this panel can communicate with the extension
		VscodeMapPanelProvider.setupMessageHandler(panel)

		// The map is shown again (a tab switch, a window focus): watchers can drop events, so every file is looked at once.
		panel.onDidChangeViewState((event) => {
			if (event.webviewPanel.visible) {
				void VscodeMapPanelProvider.fileWatch?.checkAll()
			}
		})

		// Handle disposal
		panel.onDidDispose(
			() => {
				VscodeMapPanelProvider.currentPanel = undefined
				VscodeMapPanelProvider.pageReady = false
				VscodeMapPanelProvider.fileWatch?.cancelRequests()
				// Clean up disposables
				while (VscodeMapPanelProvider.disposables.length) {
					const x = VscodeMapPanelProvider.disposables.pop()
					if (x) {
						x.dispose()
					}
				}
			},
			null,
			[],
		)
	}

	/** The page's answer to a parse request, checked for shape: it is page input, so nothing in it is taken on trust. */
	private static parseRefreshResult(message: any): ParseResult | undefined {
		if (typeof message?.requestId !== "string" || typeof message.ok !== "boolean") {
			return undefined
		}
		const metadata: Record<string, string> = {}
		if (message.metadata && typeof message.metadata === "object") {
			for (const [key, value] of Object.entries(message.metadata)) {
				if (typeof value === "string") {
					metadata[key] = value
				}
			}
		}
		const reason = message.reason === "changed_while_reading" || message.reason === "unsupported" ? message.reason : "parse"
		return {
			requestId: message.requestId,
			ok: message.ok,
			...(message.ok ? {} : { reason }),
			...(typeof message.message === "string" ? { message: message.message.slice(0, 300) } : {}),
			...(typeof message.geojson === "string" ? { geojson: message.geojson } : {}),
			metadata,
		}
	}

	/**
	 * Sets up message handling between the webview panel and the extension
	 * This allows the map panel to receive layer updates from the backend
	 */
	private static setupMessageHandler(panel: vscode.WebviewPanel) {
		const { WebviewProvider } = require("@core/webview")
		const { handleGrpcRequest, handleGrpcRequestCancel } = require("@/core/controller/grpc-handler")

		// Get the main webview instance to access the controller
		const mainWebview = WebviewProvider.getInstance()
		if (!mainWebview) {
			console.error("[VscodeMapPanelProvider] Cannot set up message handler: no main webview instance")
			return
		}

		// Set up message listener for this panel
		panel.webview.onDidReceiveMessage(
			async (message) => {
				const postMessageToWebview = (response: any) => panel.webview.postMessage(response)

				switch (message.type) {
					case "grpc_request": {
						if (message.grpc_request) {
							await handleGrpcRequest(mainWebview.controller, postMessageToWebview, message.grpc_request)
						}
						break
					}
					case "grpc_request_cancel": {
						if (message.grpc_request_cancel) {
							await handleGrpcRequestCancel(postMessageToWebview, message.grpc_request_cancel)
						}
						break
					}
					case "aihydro-map-panel-ready": {
						VscodeMapPanelProvider.pageReady = true
						// The page is listening: look at every loaded file once (after the layers have been restored).
						void mainWebview.controller.whenMapRestored().then(() => VscodeMapPanelProvider.fileWatch?.checkAll())
						break
					}
					case "aihydro-map-refresh-result": {
						const result = VscodeMapPanelProvider.parseRefreshResult(message)
						if (result) {
							VscodeMapPanelProvider.fileWatch?.onParseResult(result)
						}
						break
					}
					case "aihydro-map-use-new-file": {
						if (typeof message.layerId === "string" && VscodeMapPanelProvider.fileWatch) {
							const outcome = await VscodeMapPanelProvider.fileWatch.useNewFile(message.layerId)
							if (!outcome.ok) {
								await panel.webview.postMessage({
									type: "aihydro-map-file-status",
									kind: "err",
									message: outcome.reason,
								})
							}
						}
						break
					}
					case "aihydro-map-layer-source-status": {
						// The map drew a saved copy because a layer's file could not be read. Only that one status is accepted, and
						// only for a layer that names a file and is not a tool's: a tool's layer has no file to be missing.
						const controller = mainWebview?.controller
						if (controller && typeof message.layerId === "string" && message.status === "source_missing") {
							const layer = controller.getMapLayers().find((l: { id: string }) => l.id === message.layerId)
							const meta = layer?.metadata ?? {}
							if (layer && resolvedSourcePath(meta) && !(meta.tool || meta._run_id)) {
								controller.updateMapLayer(layer.id, { metadata: { source_status: "source_missing" } })
							}
						}
						break
					}
					case "aihydro-hydro-command": {
						if (mainWebview?.controller) {
							await handleHydroMapCommand(mainWebview.controller, message, async (response) => {
								await postMessageToWebview(response)
							})
						}
						break
					}
					case "aihydro-map-agent-task": {
						if (mainWebview?.controller) {
							await handleMapAgentTaskMessage(mainWebview.controller, message, async (response) => {
								await postMessageToWebview(response)
							})
						}
						break
					}
					case "aihydro-resolve-file-uri": {
						const requestId = message.requestId
						const filePath = typeof message.path === "string" ? await resolveMapFilePath(message.path, message) : ""
						try {
							if (!filePath) {
								throw new Error("Missing file path")
							}
							const decision = await authorizeForMap(filePath, "read", VscodeMapPanelProvider.controller)
							if (!decision.ok) {
								throw new Error(decision.reason)
							}
							const uri = vscode.Uri.file(decision.path)
							VscodeMapPanelProvider.allowLocalFileRoots(panel, [vscode.Uri.file(path.dirname(uri.fsPath))])
							await panel.webview.postMessage({
								type: "aihydro-resolve-file-uri-result",
								requestId,
								ok: true,
								name: path.basename(uri.fsPath),
								uri: panel.webview.asWebviewUri(uri).toString(),
								// The one absolute path this file has, so a reload records the file and not the spelling it was asked
								// for. A copy found in AI-Hydro's own directories is not the project file, so it is not offered as one.
								...(path.relative(aihydroPath(), uri.fsPath).startsWith("..") ? { path: uri.fsPath } : {}),
							})
						} catch (err) {
							await panel.webview.postMessage({
								type: "aihydro-resolve-file-uri-result",
								requestId,
								ok: false,
								error: err instanceof Error ? err.message : String(err),
							})
						}
						break
					}
					case "aihydro-open-source-file": {
						const filePath =
							typeof message.path === "string"
								? await resolveMapFilePath(message.path, { ...message, kind: "project" })
								: ""
						try {
							if (!filePath) {
								throw new Error("Missing source file path")
							}
							const decision = await authorizeForMap(filePath, "open", VscodeMapPanelProvider.controller)
							if (!decision.ok) {
								throw new Error(decision.reason)
							}
							// vscode.open picks the right editor for the file (a GeoTIFF is not a text document).
							await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(decision.path), {
								preview: false,
							})
						} catch (err) {
							vscode.window.showWarningMessage(
								`AI-Hydro Map: Could not open source file: ${err instanceof Error ? err.message : String(err)}`,
							)
						}
						break
					}
					case "aihydro-pick-images": {
						const requestId = message.requestId
						const picked = await vscode.window.showOpenDialog({
							title: "AI-Hydro Map: Attach Site Photos",
							canSelectMany: true,
							filters: { Images: ["jpg", "jpeg", "png", "gif", "webp", "bmp"] },
						})
						const paths = (picked ?? []).map((u) => u.fsPath)
						await panel.webview.postMessage({
							type: "aihydro-pick-images-result",
							requestId,
							paths,
						})
						break
					}
					case "aihydro-map-load-project-file": {
						// A project file the extension host cannot read to text (GeoTIFF, KMZ): the map panel parses it. The
						// request must name a file of the current scan, by open folder and relative path.
						const controller = VscodeMapPanelProvider.controller
						const checked = checkProjectFileRequest(
							message,
							controller?.getWorkspaceGeoJsonFiles() ?? [],
							(vscode.workspace.workspaceFolders ?? []).map((f) => ({ path: f.uri.fsPath })),
						)
						if (!checked.ok) {
							vscode.window.showWarningMessage(`AI-Hydro Map: ${checked.reason}`)
							break
						}
						await VscodeMapPanelProvider.sendFileUrisToMap([vscode.Uri.file(checked.absolutePath)])
						break
					}
					case "aihydro-map-add-file-command": {
						await VscodeMapPanelProvider.addFilesFromDialog()
						break
					}
					case "aihydro-map-add-url-command": {
						await VscodeMapPanelProvider.addLayerFromUrl()
						break
					}
					case "aihydro-map-open-run": {
						// A layer's "Open run": the ids come from layer metadata, so they are checked before Replay opens.
						const ids = validReplayIds(message.study_id, message.run_id)
						if (ids) {
							const { VscodeReplayProvider } = require("@/hosts/vscode/VscodeReplayProvider")
							void VscodeReplayProvider.openWithSession(ids.sessionId, ids.runId)
						} else {
							void vscode.window.showWarningMessage("This layer does not name a run that can be opened.")
						}
						break
					}
					case "aihydro-map-gallery-command": {
						await VscodeMapPanelProvider.openMapGallery()
						break
					}
					case "aihydro-research-gallery-catalog": {
						await VscodeMapPanelProvider.postResearchGalleryCatalog(panel, String(message.requestId ?? ""))
						break
					}
					case "aihydro-research-gallery-import": {
						await VscodeMapPanelProvider.importResearchGalleryItem(
							panel,
							String(message.requestId ?? ""),
							message.item as ResearchGalleryItem,
						)
						break
					}
					case "aihydro-research-gallery-star": {
						await VscodeMapPanelProvider.setResearchGalleryStar(
							panel,
							String(message.requestId ?? ""),
							String(message.itemId ?? ""),
							Boolean(message.starred),
						)
						break
					}
					case "openExternal": {
						await VscodeMapPanelProvider.openExternalUrl(String(message.url ?? ""))
						break
					}
					case "aihydro-map-save-annotations": {
						// One save at a time, in the order the webview sent them. Each save has a sequence number that the
						// webview treats as "this and everything before it is on disk"; running them concurrently could let a
						// slower, older write land last and make "Saved" untrue.
						VscodeMapPanelProvider.pinSaveQueue = VscodeMapPanelProvider.pinSaveQueue.then(async () => {
							try {
								// The webview says which project it loaded. Write only there, and only while that key still
								// belongs to the open folder; otherwise the folder changed under it, so it reloads instead.
								const current = await VscodeMapPanelProvider.pinProjectKeys()
								if (checkSaveTarget(message.projectKey, current) === "write") {
									await savePinsForProject(
										VscodeMapPanelProvider.context.globalState,
										String(message.projectKey),
										message.annotations,
										message.collections,
									)
									// Tell the map what is now on disk, so it can let go of its own unsynced copies.
									await postMessageToWebview({
										type: "aihydro-map-save-ack",
										projectKey: String(message.projectKey),
										// Echoed so the pin card can tell that THIS save, not an earlier one, reached the host.
										saveSeq: typeof message.saveSeq === "number" ? message.saveSeq : undefined,
										ids: (Array.isArray(message.annotations) ? message.annotations : [])
											.map((a: { id?: unknown }) => a?.id)
											.filter((id: unknown) => typeof id === "string"),
									})
								} else {
									console.warn(
										"[Map] Refused a pin save for a project that is not open; asking the map to reload",
									)
									await postMessageToWebview({ type: "aihydro-map-pins-reload" })
								}
							} catch (err) {
								console.error("[Map] Failed to persist pins to globalState:", err)
							}
						})
						break
					}
					case "aihydro-map-quarantine-pins": {
						try {
							const kept = await quarantinePins(
								VscodeMapPanelProvider.context.globalState,
								String(message.projectKey ?? ""),
								message.entries,
							)
							if (kept > 0) {
								console.warn(
									`[Map] ${kept} unreadable pin(s) were set aside, not deleted (aihydro.map.pins.quarantine.v1)`,
								)
							}
						} catch (err) {
							console.error("[Map] Failed to quarantine pins:", err)
						}
						break
					}
					case "aihydro-map-load-annotations": {
						const requestId = message.requestId ?? ""
						try {
							const { key, dirKey } = await VscodeMapPanelProvider.pinProjectKeys()
							const loaded = await loadPinsForProject(VscodeMapPanelProvider.context.globalState, key, {
								dirKey,
								legacyLocal: message.legacyLocal,
							})
							await postMessageToWebview({
								type: "aihydro-map-load-annotations-result",
								requestId,
								ok: true,
								projectKey: loaded.projectKey,
								importedCount: loaded.importedCount,
								annotations: loaded.annotations,
								collections: loaded.collections,
							})
						} catch (err) {
							await postMessageToWebview({
								type: "aihydro-map-load-annotations-result",
								requestId,
								ok: false,
								error: err instanceof Error ? err.message : String(err),
							})
						}
						break
					}
					case "aihydro-map-save-scene-command": {
						await VscodeMapPanelProvider.requestSaveMapScene()
						break
					}
					case "aihydro-map-open-scene-command": {
						await VscodeMapPanelProvider.openMapScene()
						break
					}
					case "aihydro-write-derived-geojson": {
						const requestId = message.requestId
						try {
							const source = (message.source ?? null) as { path?: string } | null
							const written = await writeDerivedGeojson({
								folders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
								fallbackDir: VscodeMapPanelProvider.context.globalStorageUri.fsPath,
								sourcePath: typeof source?.path === "string" ? source.path : undefined,
								name: String(message.name ?? "layer.geojson"),
								geojson: typeof message.geojson === "string" ? message.geojson : "",
								provenance: {
									source,
									format: message.format ?? null,
									warnings: Array.isArray(message.warnings) ? message.warnings : [],
								},
							})
							await panel.webview.postMessage({
								type: "aihydro-write-derived-geojson-result",
								requestId,
								ok: true,
								artifactPath: written.artifactPath,
								provenancePath: written.provenancePath,
							})
						} catch (err) {
							await panel.webview.postMessage({
								type: "aihydro-write-derived-geojson-result",
								requestId,
								ok: false,
								error: err instanceof Error ? err.message : String(err),
							})
						}
						break
					}
					case "aihydro-save-map-scene": {
						try {
							const scene =
								typeof message.scene === "string" ? message.scene : JSON.stringify(message.scene ?? {}, null, 2)
							const defaultName = `ai-hydro-map-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}.aihydro-map.json`
							const target = await vscode.window.showSaveDialog({
								title: "AI-Hydro Map: Save Scene",
								defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri
									? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, defaultName)
									: vscode.Uri.joinPath(VscodeMapPanelProvider.context.globalStorageUri, defaultName),
								filters: { "AI-Hydro Map Scene": ["aihydro-map.json", "json"] },
							})
							if (!target) {
								await panel.webview.postMessage({
									type: "aihydro-save-map-scene-result",
									ok: false,
									cancelled: true,
									message: "Save cancelled.",
								})
								break
							}
							const bytes = Buffer.from(scene, "utf8")
							await vscode.workspace.fs.writeFile(target, bytes)
							await panel.webview.postMessage({
								type: "aihydro-save-map-scene-result",
								ok: true,
								path: target.fsPath,
								sha256: checksum(bytes),
							})
							vscode.window.showInformationMessage(`AI-Hydro Map scene saved: ${target.fsPath}`)
						} catch (err) {
							await panel.webview.postMessage({
								type: "aihydro-save-map-scene-result",
								ok: false,
								error: err instanceof Error ? err.message : String(err),
							})
						}
						break
					}
					case "aihydro-gee-command": {
						try {
							const parsed = geeCommandSchema.parse(message)
							const requestId = parsed.requestId
							if (parsed.command === "connect") {
								const payload = geeStatusPayloadSchema.parse(parsed.payload)
								let result = await GeeService.connect(payload?.projectId)
								result = await promptForGeeProjectAndRetry("connect", result)
								await panel.webview.postMessage({
									type: "aihydro-gee-result",
									requestId,
									ok: result.ok,
									message: result.message,
									result,
								})
							} else if (parsed.command === "status") {
								const payload = geeStatusPayloadSchema.parse(parsed.payload)
								let result = await GeeService.status(payload?.projectId)
								result = await promptForGeeProjectAndRetry("status", result)
								await panel.webview.postMessage({
									type: "aihydro-gee-result",
									requestId,
									ok: result.ok,
									message: result.message,
									result,
								})
							} else if (parsed.command === "chooseProject") {
								const projectId = await chooseGeeProject()
								await panel.webview.postMessage({
									type: "aihydro-gee-result",
									requestId,
									ok: Boolean(projectId),
									message: projectId ? `Saved GEE project: ${projectId}` : "No GEE project selected",
									result: { ok: Boolean(projectId), project_id: projectId },
								})
							} else if (parsed.command === "previewChirpsLayer") {
								const payload = geePreviewChirpsPayloadSchema.parse(parsed.payload ?? {})
								const result = await GeeService.previewChirpsLayer(payload)
								if (result.ok && (result.tile_url_template || result.tile_url)) {
									const remoteTemplate = result.tile_url_template || result.tile_url || ""
									const proxiedTemplate = await GeeTileProxyService.proxify(remoteTemplate)
									const layer = buildGeeMapLayer(
										{
											...result,
											tile_url: proxiedTemplate,
											tile_url_template: proxiedTemplate,
											remote_tile_url_template: remoteTemplate,
										} as any,
										(result as any).provenance_path,
									)
									mainWebview.controller.addMapLayer(layer)
								}
								await panel.webview.postMessage({
									type: "aihydro-gee-result",
									requestId,
									ok: result.ok,
									message: result.message || (result.ok ? "CHIRPS layer added" : "CHIRPS layer failed"),
									result,
									error: result.error,
								})
							}
						} catch (err) {
							await panel.webview.postMessage({
								type: "aihydro-gee-result",
								requestId: message.requestId,
								ok: false,
								error: err instanceof Error ? err.message : String(err),
							})
						}
						break
					}
					default: {
						console.error("[VscodeMapPanelProvider] Received unhandled message type:", JSON.stringify(message))
					}
				}
			},
			null,
			VscodeMapPanelProvider.disposables,
		)
	}

	private static getHtmlForWebview(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(VscodeMapPanelProvider.context.extensionUri, "webview-ui", "build", "assets", "index.js"),
		)
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(VscodeMapPanelProvider.context.extensionUri, "webview-ui", "build", "assets", "index.css"),
		)

		// Use a nonce to whitelist which scripts can be run
		const nonce = getNonce()

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none';
		style-src ${webview.cspSource} 'unsafe-inline';
		script-src 'nonce-${nonce}';
		img-src ${webview.cspSource} https: data: blob:;
		font-src ${webview.cspSource} https: data:;
		connect-src https: http://127.0.0.1:* http://localhost:* ${webview.cspSource};
		worker-src blob:;">
	<link href="${styleUri}" rel="stylesheet">
	<title>AI-Hydro Map</title>
	<style>
		body {
			margin: 0;
			padding: 0;
			overflow: hidden;
			width: 100vw;
			height: 100vh;
		}
		#root {
			width: 100%;
			height: 100%;
		}
		.map-standalone {
			width: 100%;
			height: 100%;
		}
	</style>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}">
		if (typeof window.CSSStyleSheet === "undefined") {
			window.CSSStyleSheet = function CSSStyleSheet() {};
		}
		// Set standalone map mode flag
		window.AIHYDRO_MAP_STANDALONE = true;
		// See WebviewProvider.ts for why: guards against a documented blank-webview
		// crash in some runtimes when @vscode/webview-ui-toolkit's fast-element
		// lazily calls new CSSStyleSheet().
		if (typeof window.CSSStyleSheet === "undefined") {
			window.CSSStyleSheet = function CSSStyleSheet() {};
		}
	</script>
	<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
	}
}

function getNonce() {
	let text = ""
	const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length))
	}
	return text
}
