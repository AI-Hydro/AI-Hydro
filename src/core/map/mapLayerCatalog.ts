import { aihydroHome, aihydroPath } from "@shared/aihydro/aihydroHome"
import type { MapLayer } from "@shared/proto/cline/map"
import { createHash } from "crypto"
import { constants as fsConstants } from "fs"
import * as fs from "fs/promises"
import * as path from "path"
import { ensureGeoJsonPreviewArtifact } from "./geojsonPreview"

/** Directory holding the catalog files. Resolved per call (honours AIHYDRO_HOME); overridable so tests never touch the real one. */
export function defaultAihydroDir(): string {
	return aihydroHome()
}
/**
 * Marker recording that the unscoped `map_layer_catalog.json` is no longer a legacy catalog to import. It is
 * created (exclusively) when one workspace takes the legacy contents, or when the first mirror write happens.
 */
const MIGRATED_MARKER_NAME = "map_layer_catalog.migrated"
const UNSCOPED_NAME = "map_layer_catalog.json"
/** Copy of the unscoped file taken before the first mirror write replaces its contents. Never overwritten. */
const LEGACY_BACKUP_NAME = "map_layer_catalog.legacy-backup.json"
/**
 * Per-workspace catalog file. The legacy global file is migrated into the first workspace that loads it (see
 * `readMapLayerCatalog`), so layers from other investigations no longer pile up in every window.
 */
export function scopedMapLayerCatalogFile(workspaceRoot: string, baseDir: string = defaultAihydroDir()): string {
	const key = createHash("sha1").update(workspaceRoot).digest("hex").slice(0, 12)
	return path.join(baseDir, `map_layer_catalog.${key}.json`)
}
const geojsonCacheDir = () => aihydroPath("map_layer_geojson_cache")
// Tool-pushed layers may be arbitrarily large (>512 KB). We always cache them
// so they can be restored on extension reload. User-loaded layers keep the old cap.
const MAX_GEOJSON_CACHE_BYTES_USER = 512_000
const MAX_GEOJSON_CACHE_BYTES_TOOL = 20_000_000 // 20 MB

export interface NumericAttributeSummary {
	name: string
	min: number
	max: number
	mean: number
}

export interface GraduatedSummary {
	attr: string
	method: string
	classes: number
	ramp: string
}

export interface MapLayerCatalogEntry {
	id: string
	name: string
	layer_type: string
	visible: boolean
	source: string
	workspace_path: string
	/** Absolute path to cached geojson when layer has no workspace file (tool-pushed). */
	geojson_cache_path: string
	/** Absolute path to the PNG on disk (raster layers). Used for hydration on reload. */
	raster_path: string
	/** JSON string of [west, south, east, north] bounds for raster layers. */
	raster_bounds: string
	raster_colormap: string
	raster_opacity: string
	/** Absolute path to inundation_3d manifest JSON (inundation_3d layers). */
	inundation_3d_manifest_path: string
	style: Record<string, number | string>
	symbology_mode: "basic" | "graduated" | "raster" | "none"
	graduated?: GraduatedSummary
	numeric_attributes: NumericAttributeSummary[]
	feature_count: number
	/** All raw layer metadata — used to reconstruct MapLayer on hydration. */
	metadata_snapshot: Record<string, string>
}

export interface MapLayerCatalog {
	/** Workspace folder the catalog was written for. Absent in catalogs written before scoping existed. */
	workspace_root?: string
	updated_at_ms: number
	layer_order: string[]
	layers: MapLayerCatalogEntry[]
}

export function extractNumericAttributes(geojson: string): NumericAttributeSummary[] {
	if (!geojson?.trim()) {
		return []
	}
	try {
		const parsed = JSON.parse(geojson) as {
			type?: string
			features?: Array<{ properties?: Record<string, unknown> }>
			properties?: Record<string, unknown>
		}
		const features =
			parsed.type === "FeatureCollection" && Array.isArray(parsed.features)
				? parsed.features
				: parsed.type === "Feature"
					? [{ properties: parsed.properties }]
					: []
		const attrs = new Map<string, number[]>()
		for (const f of features) {
			const props = f.properties || {}
			for (const [key, val] of Object.entries(props)) {
				if (typeof val === "number" && !key.startsWith("_")) {
					const list = attrs.get(key) ?? []
					list.push(val)
					attrs.set(key, list)
				}
			}
		}
		const result: NumericAttributeSummary[] = []
		for (const [name, values] of attrs) {
			const sorted = [...values].sort((a, b) => a - b)
			const sum = values.reduce((a, b) => a + b, 0)
			result.push({
				name,
				min: sorted[0],
				max: sorted[sorted.length - 1],
				mean: sum / values.length,
			})
		}
		return result.sort((a, b) => a.name.localeCompare(b.name))
	} catch {
		return []
	}
}

function countFeatures(geojson: string): number {
	if (!geojson?.trim()) {
		return 0
	}
	try {
		const parsed = JSON.parse(geojson) as { type?: string; features?: unknown[] }
		if (parsed.type === "FeatureCollection" && Array.isArray(parsed.features)) {
			return parsed.features.length
		}
		if (parsed.type === "Feature") {
			return 1
		}
		return 1
	} catch {
		return 0
	}
}

function resolveLayerSource(layer: MapLayer): string {
	const meta = layer.metadata ?? {}
	if (meta.source) {
		return meta.source
	}
	if (meta.path) {
		return "workspace"
	}
	if (meta._run_id || meta.tool) {
		return "tool"
	}
	return "map"
}

function resolveSymbologyMode(layer: MapLayer): MapLayerCatalogEntry["symbology_mode"] {
	const meta = layer.metadata ?? {}
	if (layer.layerType === "raster" || layer.layerType === "gee_tile") {
		return "raster"
	}
	if (meta.graduated_attr && meta.graduated_breaks) {
		return "graduated"
	}
	if (layer.style?.fillColor || layer.style?.strokeColor || layer.style?.color) {
		return "basic"
	}
	return "none"
}

function buildGraduatedSummary(layer: MapLayer): GraduatedSummary | undefined {
	const meta = layer.metadata ?? {}
	if (!meta.graduated_attr) {
		return undefined
	}
	let classes = 0
	try {
		const breaks = JSON.parse(meta.graduated_breaks || "[]") as number[]
		classes = breaks.length
	} catch {
		classes = 0
	}
	return {
		attr: meta.graduated_attr,
		method: meta.graduated_method || "equal",
		classes,
		ramp: meta.graduated_ramp || "viridis",
	}
}

function styleToRecord(layer: MapLayer): Record<string, number | string> {
	const s = layer.style
	if (!s) {
		return {}
	}
	const out: Record<string, number | string> = {}
	if (s.fillColor) out.fillColor = s.fillColor
	if (s.fillOpacity !== undefined) out.fillOpacity = s.fillOpacity
	if (s.strokeColor) out.strokeColor = s.strokeColor
	if (s.color) out.color = s.color
	if (s.strokeWidth !== undefined) out.strokeWidth = s.strokeWidth
	if (s.weight !== undefined) out.weight = s.weight
	if (s.opacity !== undefined) out.opacity = s.opacity
	if (layer.layerType === "raster") {
		if (layer.metadata?.raster_colormap) out.raster_colormap = layer.metadata.raster_colormap
		if (layer.metadata?.raster_opacity) out.raster_opacity = layer.metadata.raster_opacity
	}
	return out
}

export function layerToCatalogEntry(layer: MapLayer, geojsonCachePath = "", displayGeojsonPath = ""): MapLayerCatalogEntry {
	const meta = layer.metadata ?? {}
	const workspacePath = meta.path || meta.workspace_path || ""
	// Strip large blobs from the metadata snapshot — raster_data_url can be
	// several MB and is reproduced from raster_path on hydration.
	const metaSnapshot: Record<string, string> = {}
	for (const [k, v] of Object.entries(meta)) {
		if (k === "raster_data_url" || k === "inundation_3d_manifest_json") {
			continue
		}
		if (typeof v === "string") {
			metaSnapshot[k] = v
		}
	}
	if (displayGeojsonPath) {
		metaSnapshot.display_geojson_path = displayGeojsonPath
		metaSnapshot.display_mode = "preview"
	}
	return {
		id: layer.id,
		name: meta.display_name || layer.name || layer.id,
		layer_type: layer.layerType || "polygon",
		visible: layer.visible !== false,
		source: resolveLayerSource(layer),
		workspace_path: workspacePath,
		geojson_cache_path: geojsonCachePath,
		raster_path: meta.raster_path || "",
		raster_bounds: meta.raster_bounds || "",
		raster_colormap: meta.raster_colormap || "viridis",
		raster_opacity: meta.raster_opacity || "0.75",
		inundation_3d_manifest_path: meta.inundation_3d_manifest_path || "",
		style: styleToRecord(layer),
		symbology_mode: resolveSymbologyMode(layer),
		graduated: buildGraduatedSummary(layer),
		numeric_attributes: extractNumericAttributes(layer.geojson || ""),
		feature_count: countFeatures(layer.geojson || ""),
		metadata_snapshot: metaSnapshot,
	}
}

function isToolPushedLayer(layer: MapLayer): boolean {
	const meta = layer.metadata ?? {}
	return !!(meta.tool || meta._run_id || meta.source === "HAND+SRC")
}

function isUsableAbsolutePath(filePath: string | undefined): boolean {
	return Boolean(filePath && path.isAbsolute(filePath))
}

async function cacheLayerGeojsonIfNeeded(layer: MapLayer): Promise<string> {
	const meta = layer.metadata ?? {}
	if (isUsableAbsolutePath(meta.path) || isUsableAbsolutePath(meta.workspace_path)) {
		return ""
	}
	const geojson = layer.geojson?.trim()
	if (!geojson) {
		return ""
	}
	const bytes = Buffer.byteLength(geojson, "utf8")
	const cap = isToolPushedLayer(layer) ? MAX_GEOJSON_CACHE_BYTES_TOOL : MAX_GEOJSON_CACHE_BYTES_USER
	if (bytes > cap) {
		return ""
	}
	try {
		await fs.mkdir(geojsonCacheDir(), { recursive: true })
		const safeId = layer.id.replace(/[^a-zA-Z0-9_-]/g, "_")
		const cachePath = path.join(geojsonCacheDir(), `${safeId}.geojson`)
		await fs.writeFile(cachePath, geojson, "utf8")
		return cachePath
	} catch {
		return ""
	}
}

async function previewLayerGeojsonIfNeeded(layer: MapLayer): Promise<string> {
	const meta = layer.metadata ?? {}
	if (meta.display_geojson_path) {
		return meta.display_geojson_path
	}
	const geojson = layer.geojson?.trim()
	if (!geojson) {
		return ""
	}
	try {
		const preview = await ensureGeoJsonPreviewArtifact(layer.id, geojson)
		return preview?.previewPath ?? ""
	} catch {
		return ""
	}
}

/**
 * @param preserved Catalog entries that are on disk but not loaded (older than the restore cap). They are
 *   carried through every rewrite, in front of the live layers, so a rewrite never destroys them.
 */
export async function buildMapLayerCatalogAsync(
	layers: MapLayer[],
	layerOrder: string[],
	workspaceRoot?: string,
	preserved: MapLayerCatalogEntry[] = [],
): Promise<MapLayerCatalog> {
	const order = layerOrder.length > 0 ? layerOrder.filter((id) => layers.some((l) => l.id === id)) : layers.map((l) => l.id)
	for (const layer of layers) {
		if (!order.includes(layer.id)) {
			order.push(layer.id)
		}
	}
	const entries: MapLayerCatalogEntry[] = []
	for (const id of order) {
		const layer = layers.find((l) => l.id === id)
		if (!layer) {
			continue
		}
		const cachePath = await cacheLayerGeojsonIfNeeded(layer)
		const previewPath = await previewLayerGeojsonIfNeeded(layer)
		entries.push(layerToCatalogEntry(layer, cachePath, previewPath))
	}
	const liveIds = new Set(entries.map((entry) => entry.id))
	const carried = preserved.filter((entry) => !liveIds.has(entry.id))
	return {
		...(workspaceRoot ? { workspace_root: workspaceRoot } : {}),
		updated_at_ms: Date.now(),
		layer_order: [...carried.map((entry) => entry.id), ...order],
		layers: [...carried, ...entries],
	}
}

/** Sync build without geojson cache writes (used in task context). */
export function buildMapLayerCatalog(layers: MapLayer[], layerOrder: string[]): MapLayerCatalog {
	const order = layerOrder.length > 0 ? layerOrder.filter((id) => layers.some((l) => l.id === id)) : layers.map((l) => l.id)
	for (const layer of layers) {
		if (!order.includes(layer.id)) {
			order.push(layer.id)
		}
	}
	return {
		updated_at_ms: Date.now(),
		layer_order: order,
		layers: order
			.map((id) => layers.find((l) => l.id === id))
			.filter((l): l is MapLayer => l !== undefined)
			.map((layer) => layerToCatalogEntry(layer)),
	}
}

async function writeFileAtomic(file: string, text: string): Promise<void> {
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
	await fs.writeFile(tmp, text, "utf8")
	await fs.rename(tmp, file)
}

/** Creates the migrated marker; false when it already existed. */
async function claimMigratedMarker(baseDir: string): Promise<boolean> {
	try {
		await fs.mkdir(baseDir, { recursive: true })
		await fs.writeFile(path.join(baseDir, MIGRATED_MARKER_NAME), `${new Date().toISOString()}\n`, { flag: "wx" })
		return true
	} catch {
		return false
	}
}

/**
 * Before the first mirror write: preserves the old unscoped file (exclusive copy, never over an existing backup)
 * and then creates the migrated marker. Returns false when the backup failed, in which case the unscoped file
 * must not be overwritten.
 */
async function prepareUnscopedMirror(baseDir: string): Promise<boolean> {
	const marker = path.join(baseDir, MIGRATED_MARKER_NAME)
	try {
		await fs.access(marker)
		return true
	} catch {
		// no marker yet: this is the first mirror write
	}
	try {
		await fs.copyFile(path.join(baseDir, UNSCOPED_NAME), path.join(baseDir, LEGACY_BACKUP_NAME), fsConstants.COPYFILE_EXCL)
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code
		// ENOENT: nothing to preserve. EEXIST: a backup already exists and is kept as is.
		if (code !== "ENOENT" && code !== "EEXIST") {
			console.warn("[mapLayerCatalog] legacy catalog backup failed; leaving the unscoped file untouched:", err)
			return false
		}
	}
	await claimMigratedMarker(baseDir)
	return true
}

/**
 * Writes the workspace's scoped catalog and mirrors it to the unscoped `map_layer_catalog.json`.
 *
 * The mirror holds the ACTIVE workspace's catalog and exists only because aihydro-tools (the MCP map layer
 * tools) still reads the unscoped file. It can be removed once aihydro-tools reads scoped catalogs. Because the
 * unscoped file is then a mirror, the migrated marker is written first so no workspace imports it as legacy.
 */
export async function persistMapLayerCatalog(catalog: MapLayerCatalog, baseDir: string = defaultAihydroDir()): Promise<void> {
	try {
		await fs.mkdir(baseDir, { recursive: true })
		const text = JSON.stringify(catalog, null, 2)
		if (catalog.workspace_root) {
			await writeFileAtomic(scopedMapLayerCatalogFile(catalog.workspace_root, baseDir), text)
			if (!(await prepareUnscopedMirror(baseDir))) {
				return // scoped write done; mirror skipped so the old unscoped contents are not lost
			}
		}
		await writeFileAtomic(path.join(baseDir, UNSCOPED_NAME), text)
	} catch (err) {
		console.warn("[mapLayerCatalog] persist failed:", err)
	}
}

async function readCatalogFile(file: string): Promise<MapLayerCatalog | null> {
	try {
		return JSON.parse(await fs.readFile(file, "utf8")) as MapLayerCatalog
	} catch {
		return null
	}
}

/**
 * Reads the catalog for a workspace. A workspace with no catalog of its own takes over the legacy unscoped file
 * exactly once: the `map_layer_catalog.migrated` marker is created exclusively (an atomic claim, so two windows
 * racing for it cannot both import), then the legacy contents are written to this workspace's scoped file. Once
 * the marker exists the unscoped file is the active-workspace mirror (see `persistMapLayerCatalog`), so other
 * workspaces start empty instead of importing it. With no workspace folder the unscoped file is read in place.
 */
export async function readMapLayerCatalog(
	workspaceRoot?: string,
	baseDir: string = defaultAihydroDir(),
): Promise<MapLayerCatalog | null> {
	const unscopedFile = path.join(baseDir, UNSCOPED_NAME)
	if (!workspaceRoot) {
		return readCatalogFile(unscopedFile)
	}
	const scoped = await readCatalogFile(scopedMapLayerCatalogFile(workspaceRoot, baseDir))
	if (scoped) {
		return scoped
	}
	const legacy = await readCatalogFile(unscopedFile)
	if (!legacy || !(await claimMigratedMarker(baseDir))) {
		return null // nothing to migrate, or migration already happened (the unscoped file is now a mirror)
	}
	const migrated: MapLayerCatalog = { ...legacy, workspace_root: workspaceRoot }
	await persistMapLayerCatalog(migrated, baseDir)
	return migrated
}
