import type { MapEvent, MapLayer, MapRoi, MapSessionState, MapSessionView } from "@shared/proto/cline/map"
import { MapRoi as MapRoiProto, MapSessionState as MapSessionStateProto } from "@shared/proto/cline/map"
import { execFile } from "child_process"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { promisify } from "util"

const MAP_SESSION_FILE = path.join(os.homedir(), ".aihydro", "map_session.json")
const OUTBOUND_EVENTS_DIR = path.join(os.homedir(), ".aihydro", "map_events", "outbound")
const MAX_EVENTS = 100
const execFileAsync = promisify(execFile)

export type MapSessionSubscriber = (state: MapSessionState) => void
export type MapEventSubscriber = (event: MapEvent) => void

export interface LastMapInspect {
	lat: number
	lon: number
	layerName?: string
	featureProperties?: Record<string, unknown>
	visibleLayerNames?: string[]
	featureCount?: number
}

export interface MapSessionPersistenceIo {
	mkdir(directory: string, options: { recursive: true }): Promise<unknown>
	readFile(file: string, encoding: "utf8"): Promise<string>
	writeFile(file: string, data: string, encoding: "utf8"): Promise<unknown>
	rename(oldPath: string, newPath: string): Promise<void>
	rm(file: string, options: { force: true }): Promise<unknown>
}

export interface MapSessionServiceOptions {
	workspaceRoot?: string
	sessionFile?: string
	outboundEventsDir?: string
	persistenceIo?: MapSessionPersistenceIo
}

const defaultPersistenceIo: MapSessionPersistenceIo = {
	mkdir: (directory, options) => fs.mkdir(directory, options),
	readFile: (file, encoding) => fs.readFile(file, encoding),
	writeFile: (file, data, encoding) => fs.writeFile(file, data, encoding),
	rename: (oldPath, newPath) => fs.rename(oldPath, newPath),
	rm: (file, options) => fs.rm(file, options),
}

function slugify(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "_")
			.replace(/^_|_$/g, "")
			.slice(0, 64) || "roi"
	)
}

/**
 * Host-owned map session: ROI, view, event ring buffer, workspace persistence.
 */
export class MapSessionService {
	private activeRoi: MapRoi | undefined
	private view: MapSessionView | undefined
	private visibleLayerIds: string[] = []
	private basemapId = ""
	private basemapName = ""
	private workspaceRoot: string = ""
	private updatedAtMs = Date.now()
	private events: MapEvent[] = []
	private lastInspect: LastMapInspect | undefined
	private sessionSubscribers = new Set<MapSessionSubscriber>()
	private eventSubscribers = new Set<MapEventSubscriber>()
	private readonly sessionFile: string
	private readonly outboundEventsDir: string
	private readonly persistenceIo: MapSessionPersistenceIo
	private initializationPromise: Promise<void> | undefined
	private stateRevision = 0
	private persistenceTail: Promise<void> = Promise.resolve()
	private latestPersistence: Promise<void> = Promise.resolve()
	private eventPersistenceTail: Promise<void> = Promise.resolve()
	private tempFileSequence = 0
	private roiOperationTail: Promise<void> = Promise.resolve()

	constructor(workspaceRootOrOptions?: string | MapSessionServiceOptions) {
		const options =
			typeof workspaceRootOrOptions === "string" ? { workspaceRoot: workspaceRootOrOptions } : workspaceRootOrOptions
		this.sessionFile = options?.sessionFile ?? MAP_SESSION_FILE
		this.outboundEventsDir = options?.outboundEventsDir ?? OUTBOUND_EVENTS_DIR
		this.persistenceIo = options?.persistenceIo ?? defaultPersistenceIo
		if (options?.workspaceRoot) {
			this.workspaceRoot = this.normalizeWorkspaceRoot(options.workspaceRoot)
		}
	}

	async initialize(): Promise<void> {
		this.initializationPromise ??= this.loadFromDisk()
		await this.initializationPromise
	}

	setWorkspaceRoot(root: string): void {
		const normalizedRoot = this.normalizeWorkspaceRoot(root)
		if (normalizedRoot && normalizedRoot !== this.normalizeWorkspaceRoot(this.workspaceRoot)) {
			this.workspaceRoot = normalizedRoot
			this.activeRoi = undefined
			this.visibleLayerIds = []
			this.touch()
			this.notifySession()
			this.schedulePersist()
		}
	}

	serializeRoiOperation<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.roiOperationTail.then(async () => {
			await this.initialize()
			return operation()
		})
		this.roiOperationTail = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}

	getActiveRoi(): MapRoi | undefined {
		return this.activeRoi
	}

	setActiveRoi(roi: MapRoi | undefined, source: string = "user"): void {
		if (!roi?.geojson?.trim()) {
			this.clearActiveRoi(source)
			return
		}
		this.activeRoi = roi
		this.touch()
		this.notifySession()
		this.schedulePersist()
		this.appendEvent({
			type: "roi.set",
			payloadJson: JSON.stringify({ name: roi.name, source: roi.source, areaHa: roi.areaHa }),
			timestampMs: Date.now(),
			source,
		})
	}

	clearActiveRoi(source: string = "user"): void {
		if (!this.activeRoi) {
			return
		}
		this.activeRoi = undefined
		this.touch()
		this.notifySession()
		this.schedulePersist()
		this.appendEvent({
			type: "roi.cleared",
			payloadJson: "{}",
			timestampMs: Date.now(),
			source,
		})
	}

	setView(view: MapSessionView): void {
		this.view = view
		this.touch()
		this.notifySession()
		this.schedulePersist()
	}

	setVisibleLayerIds(ids: string[]): void {
		this.visibleLayerIds = ids
		this.touch()
		this.notifySession()
		this.schedulePersist()
	}

	getBasemap(): { id: string; name: string } | undefined {
		if (!this.basemapId) {
			return undefined
		}
		return { id: this.basemapId, name: this.basemapName || this.basemapId }
	}

	getView(): MapSessionView | undefined {
		return this.view
	}

	setBasemap(id: string, name?: string): void {
		if (!id?.trim()) {
			return
		}
		this.basemapId = id.trim()
		this.basemapName = name?.trim() || id
		this.touch()
		this.notifySession()
		this.schedulePersist()
	}

	appendEvent(event: MapEvent): void {
		this.events.push(event)
		if (this.events.length > MAX_EVENTS) {
			this.events = this.events.slice(-MAX_EVENTS)
		}
		for (const sub of this.eventSubscribers) {
			try {
				sub(event)
			} catch (err) {
				console.error("[MapSessionService] event subscriber error:", err)
			}
		}
		this.eventPersistenceTail = this.eventPersistenceTail
			.then(() => this.mirrorEventToDisk(event))
			.catch((err) => console.warn("[MapSessionService] event persistence failed:", err))
	}

	getRecentEvents(limit = 20): MapEvent[] {
		const n = Math.max(1, Math.min(limit, MAX_EVENTS))
		return this.events.slice(-n)
	}

	setLastInspect(inspect: LastMapInspect): void {
		this.lastInspect = inspect
		this.touch()
	}

	getLastInspect(): LastMapInspect | undefined {
		return this.lastInspect
	}

	buildSnapshot(layers: MapLayer[]): MapSessionState {
		return MapSessionStateProto.create({
			layers,
			activeRoi: this.activeRoi,
			view: this.view,
			visibleLayerIds: this.visibleLayerIds,
			workspaceRoot: this.workspaceRoot,
			updatedAtMs: this.updatedAtMs,
			basemapId: this.basemapId,
			basemapName: this.basemapName,
		})
	}

	subscribeToSession(cb: MapSessionSubscriber): () => void {
		this.sessionSubscribers.add(cb)
		return () => this.sessionSubscribers.delete(cb)
	}

	subscribeToEvents(cb: MapEventSubscriber): () => void {
		this.eventSubscribers.add(cb)
		return () => this.eventSubscribers.delete(cb)
	}

	/** Save drawn or imported geometry as a workspace vector file (no global ROI pointer). */
	async saveGeometryToWorkspace(name: string, geojson: string, format: string = "geojson"): Promise<{ workspacePath: string }> {
		const root = this.workspaceRoot
		if (!root) {
			throw new Error("Workspace root not set — open a folder workspace first")
		}
		if (!geojson?.trim()) {
			throw new Error("No geometry to save")
		}
		const slug = slugify(name || "drawn")
		const vectorsDir = path.join(root, "vectors")
		await fs.mkdir(vectorsDir, { recursive: true })
		if (format === "shapefile" || format === "shp") {
			const relZip = `vectors/${slug}.shp.zip`
			await this.writeShapefileZip(geojson, path.join(root, relZip), slug)
			this.appendEvent({
				type: "user.file_saved",
				payloadJson: JSON.stringify({ path: relZip, name: slug, format: "shapefile" }),
				timestampMs: Date.now(),
				source: "user",
			})
			return { workspacePath: relZip }
		}
		const relGeo = `vectors/${slug}.geojson`
		await fs.writeFile(path.join(root, relGeo), geojson, "utf8")
		this.appendEvent({
			type: "user.file_saved",
			payloadJson: JSON.stringify({ path: relGeo, name: slug }),
			timestampMs: Date.now(),
			source: "user",
		})
		return { workspacePath: relGeo }
	}

	private async writeShapefileZip(geojson: string, outZipPath: string, slug: string): Promise<void> {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihydro-shp-"))
		const inputPath = path.join(tmpDir, "input.geojson")
		await fs.writeFile(inputPath, geojson, "utf8")
		const script = `
import geopandas as gpd
import pathlib
import sys
import zipfile

src = pathlib.Path(sys.argv[1])
out_zip = pathlib.Path(sys.argv[2])
name = sys.argv[3]
work = out_zip.with_suffix("")
work.mkdir(parents=True, exist_ok=True)
gdf = gpd.read_file(src)
if gdf.empty:
    raise SystemExit("No features to export")
for col in list(gdf.columns):
    if col != "geometry" and gdf[col].map(lambda v: isinstance(v, (dict, list))).any():
        gdf[col] = gdf[col].astype(str)
shp_path = work / f"{name}.shp"
gdf.to_file(shp_path, driver="ESRI Shapefile")
with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as zf:
    for item in work.iterdir():
        if item.is_file():
            zf.write(item, arcname=item.name)
`
		let lastError: unknown
		for (const python of ["python3", "python"]) {
			try {
				await execFileAsync(python, ["-c", script, inputPath, outZipPath, slug], { timeout: 120_000 })
				await fs.rm(tmpDir, { recursive: true, force: true })
				return
			} catch (err) {
				lastError = err
			}
		}
		await fs.rm(tmpDir, { recursive: true, force: true })
		const detail = lastError instanceof Error ? lastError.message : String(lastError)
		throw new Error(`Could not export shapefile. Install geopandas/fiona for Python shapefile export. ${detail}`)
	}

	async saveRoiToWorkspace(name: string, roi?: MapRoi): Promise<{ workspacePath: string; activePointerPath: string }> {
		const target = roi ?? this.activeRoi
		if (!target?.geojson?.trim()) {
			throw new Error("No active ROI geometry to save")
		}
		const root = this.workspaceRoot
		if (!root) {
			throw new Error("Workspace root not set — open a folder workspace first")
		}
		const slug = slugify(name || target.name || "basin")
		const roiDir = path.join(root, "roi")
		await fs.mkdir(roiDir, { recursive: true })
		const geoPath = path.join(roiDir, `${slug}.geojson`)
		await fs.writeFile(geoPath, target.geojson, "utf8")
		const relGeo = `roi/${slug}.geojson`
		const pointer = {
			path: relGeo,
			name: target.name || slug,
			updatedAt: new Date().toISOString(),
		}
		const relPointer = "roi/active.json"
		await fs.writeFile(path.join(root, relPointer), JSON.stringify(pointer, null, 2), "utf8")
		this.activeRoi = {
			...target,
			workspacePath: relGeo,
			source: target.source || "workspace",
		}
		this.touch()
		this.notifySession()
		await this.enqueuePersistence()
		this.appendEvent({
			type: "roi.saved",
			payloadJson: JSON.stringify({ path: relGeo, name: pointer.name }),
			timestampMs: Date.now(),
			source: "user",
		})
		return { workspacePath: relGeo, activePointerPath: relPointer }
	}

	async loadRoiFromWorkspace(workspacePath?: string): Promise<MapRoi> {
		const root = this.workspaceRoot
		if (!root) {
			throw new Error("Workspace root not set")
		}
		let relPath = workspacePath?.trim()
		if (!relPath) {
			const pointerPath = path.join(root, "roi", "active.json")
			const raw = await fs.readFile(pointerPath, "utf8")
			const pointer = JSON.parse(raw) as { path?: string; name?: string }
			relPath = pointer.path
			if (!relPath) {
				throw new Error("roi/active.json has no path")
			}
		}
		const abs = path.isAbsolute(relPath) ? relPath : path.join(root, relPath)
		const geojson = await fs.readFile(abs, "utf8")
		const loaded = MapRoiProto.create({
			id: slugify(path.basename(relPath, ".geojson")),
			name: path.basename(relPath, ".geojson"),
			source: "workspace",
			geojson,
			areaHa: 0,
			workspacePath: relPath,
		})
		this.setActiveRoi(loaded, "user")
		return loaded
	}

	/** Read map session ROI from disk file (for Python bridge). */
	static async readPersistedSession(): Promise<{ activeRoi?: MapRoi } | null> {
		try {
			const raw = await fs.readFile(MAP_SESSION_FILE, "utf8")
			return JSON.parse(raw) as { activeRoi?: MapRoi }
		} catch {
			return null
		}
	}

	private touch(): void {
		this.stateRevision += 1
		this.updatedAtMs = Date.now()
	}

	private notifySession(): void {
		for (const sub of this.sessionSubscribers) {
			try {
				sub(this.buildSnapshot([]))
			} catch (err) {
				console.error("[MapSessionService] session subscriber error:", err)
			}
		}
	}

	private normalizeWorkspaceRoot(root: string): string {
		return root?.trim() ? path.resolve(root) : ""
	}

	private persistenceSnapshot(): string {
		return JSON.stringify(
			{
				activeRoi: this.activeRoi,
				view: this.view,
				visibleLayerIds: [...this.visibleLayerIds],
				basemapId: this.basemapId,
				basemapName: this.basemapName,
				workspaceRoot: this.workspaceRoot,
				updatedAtMs: this.updatedAtMs,
			},
			null,
			2,
		)
	}

	private schedulePersist(): void {
		void this.enqueuePersistence().catch((err) => console.warn("[MapSessionService] persist failed:", err))
	}

	private enqueuePersistence(): Promise<void> {
		const payload = this.persistenceSnapshot()
		const operation = this.persistenceTail.then(async () => {
			await this.initialize()
			await this.persistenceIo.mkdir(path.dirname(this.sessionFile), { recursive: true })
			const temporaryFile = `${this.sessionFile}.${process.pid}.${++this.tempFileSequence}.tmp`
			try {
				await this.persistenceIo.writeFile(temporaryFile, payload, "utf8")
				await this.persistenceIo.rename(temporaryFile, this.sessionFile)
			} catch (error) {
				try {
					await this.persistenceIo.rm(temporaryFile, { force: true })
				} catch {
					// Preserve the original durability failure.
				}
				throw error
			}
		})
		this.persistenceTail = operation.then(
			() => undefined,
			() => undefined,
		)
		this.latestPersistence = operation
		return operation
	}

	async flushPersistence(): Promise<void> {
		await this.initialize()
		await this.latestPersistence
		await this.eventPersistenceTail
	}

	private async loadFromDisk(): Promise<void> {
		try {
			const raw = await this.persistenceIo.readFile(this.sessionFile, "utf8")
			const data = JSON.parse(raw) as {
				activeRoi?: MapRoi
				view?: MapSessionView
				visibleLayerIds?: string[]
				basemapId?: string
				basemapName?: string
				workspaceRoot?: string
				updatedAtMs?: number
			}
			if (this.stateRevision !== 0) {
				return
			}
			const requestedWorkspace = this.workspaceRoot
			const persistedWorkspace = this.normalizeWorkspaceRoot(data.workspaceRoot ?? "")
			const workspaceMatches = !requestedWorkspace || requestedWorkspace === persistedWorkspace
			this.activeRoi = workspaceMatches ? data.activeRoi : undefined
			this.view = data.view
			this.visibleLayerIds = workspaceMatches ? (data.visibleLayerIds ?? []) : []
			this.basemapId = data.basemapId ?? ""
			this.basemapName = data.basemapName ?? ""
			if (!requestedWorkspace && persistedWorkspace) {
				this.workspaceRoot = persistedWorkspace
			}
			this.updatedAtMs = data.updatedAtMs ?? Date.now()
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return
			}
			const detail = error instanceof Error ? error.message : String(error)
			throw new Error(`Could not initialize map session from ${this.sessionFile}: ${detail}`)
		}
	}

	private async mirrorEventToDisk(event: MapEvent): Promise<void> {
		await this.persistenceIo.mkdir(this.outboundEventsDir, { recursive: true })
		const file = path.join(this.outboundEventsDir, `${event.timestampMs ?? Date.now()}.json`)
		await this.persistenceIo.writeFile(file, JSON.stringify(event), "utf8")
	}
}
