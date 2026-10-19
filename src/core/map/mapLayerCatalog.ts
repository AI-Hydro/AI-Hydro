import type { MapLayer } from "@shared/proto/cline/map"
import * as fs from "fs/promises"
import * as path from "path"
import { ensureGeoJsonPreviewArtifact } from "./geojsonPreview"
import { aihydroPath } from "@shared/aihydro/aihydroHome"

export const MAP_LAYER_CATALOG_FILE = aihydroPath("map_layer_catalog.json")
const MAP_LAYER_GEOJSON_CACHE_DIR = aihydroPath("map_layer_geojson_cache")
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
		await fs.mkdir(MAP_LAYER_GEOJSON_CACHE_DIR, { recursive: true })
		const safeId = layer.id.replace(/[^a-zA-Z0-9_-]/g, "_")
		const cachePath = path.join(MAP_LAYER_GEOJSON_CACHE_DIR, `${safeId}.geojson`)
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

export async function buildMapLayerCatalogAsync(layers: MapLayer[], layerOrder: string[]): Promise<MapLayerCatalog> {
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
	return {
		updated_at_ms: Date.now(),
		layer_order: order,
		layers: entries,
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

export async function persistMapLayerCatalog(catalog: MapLayerCatalog): Promise<void> {
	try {
		await fs.mkdir(path.dirname(MAP_LAYER_CATALOG_FILE), { recursive: true })
		await fs.writeFile(MAP_LAYER_CATALOG_FILE, JSON.stringify(catalog, null, 2), "utf8")
	} catch (err) {
		console.warn("[mapLayerCatalog] persist failed:", err)
	}
}

export async function readMapLayerCatalog(): Promise<MapLayerCatalog | null> {
	try {
		const raw = await fs.readFile(MAP_LAYER_CATALOG_FILE, "utf8")
		return JSON.parse(raw) as MapLayerCatalog
	} catch {
		return null
	}
}
