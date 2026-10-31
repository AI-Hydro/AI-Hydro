/**
 * Layer panel model: the pure decisions behind the Layers list, so they can be tested without rendering.
 *
 *   origin      where a layer came from (tool output, workspace file, loaded by the user, Earth Engine, pushed)
 *   groups      layers in map order, bucketed by origin; the order inside a group is the map's draw order
 *   indicators  what a row says about itself: real warnings (always shown) and quiet notes (shown once per group
 *               when every layer in it has the same one)
 *   duplicates  layers that are the same thing twice (same tool run, same source), e.g. after a restore
 */

import { layerRunId, layerTool } from "@shared/map/provenanceEnvelope"
import type { MapLayer } from "@shared/proto/cline/map"
import { deriveLayerIntelligence, type LayerIntelligence, warningText } from "./layerIntelligence"

export type LayerOrigin = "tool" | "workspace" | "user" | "gee" | "pushed"

/** Groups appear in this order. */
export const ORIGIN_ORDER: LayerOrigin[] = ["tool", "user", "workspace", "gee", "pushed"]

export const ORIGIN_LABEL: Record<LayerOrigin, { title: string; icon: string; hint: string }> = {
	tool: { title: "Tool output", icon: "beaker", hint: "Layers an AI-Hydro tool produced" },
	workspace: { title: "Workspace files", icon: "folder", hint: "Files from your workspace" },
	user: { title: "Loaded by you", icon: "cloud-download", hint: "Layers you added from a file or URL" },
	gee: { title: "Earth Engine", icon: "globe", hint: "Google Earth Engine layers" },
	pushed: { title: "Other", icon: "layers", hint: "Layers pushed to the map without a recorded origin" },
}

export function originOf(layer: MapLayer): LayerOrigin {
	const source = layer.metadata?.source
	if (source === "gee") return "gee"
	if (source === "workspace") return "workspace"
	if (source === "user") return "user"
	if (layerRunId(layer.metadata) || layerTool(layer.metadata) || source === "tool" || source === "session") return "tool"
	return "pushed"
}

export interface LayerGroup {
	origin: LayerOrigin
	layers: MapLayer[]
}

/** Bucket layers by origin (groups in ORIGIN_ORDER), keeping the map order inside each group. */
export function groupLayers(layers: MapLayer[]): LayerGroup[] {
	const buckets = new Map<LayerOrigin, MapLayer[]>()
	for (const layer of layers) {
		const origin = originOf(layer)
		buckets.set(origin, [...(buckets.get(origin) ?? []), layer])
	}
	return ORIGIN_ORDER.filter((o) => buckets.has(o)).map((origin) => ({ origin, layers: buckets.get(origin) ?? [] }))
}

// ── indicators ──────────────────────────────────────────────────────────────

export interface RowIndicators {
	/** Real problems with the data. Always shown on the row. */
	warnings: string[]
	/** What the layer is, in one line, when that limits what can be done with it. Quiet; may move to the group. */
	note?: string
}

/**
 * What a row says about itself. A warning is something the reader must not miss (missing provenance, a changed
 * source, a preview that is not the full data, values not loaded). A note is a capability limit ("Limited layer").
 */
export function rowIndicators(layer: MapLayer, intelligence: LayerIntelligence = deriveLayerIntelligence(layer)): RowIndicators {
	const meta = layer.metadata ?? {}
	const warnings = intelligence.warnings.filter((w) => w !== "UNSUPPORTED_SYMBOLOGY").map(warningText)
	if (meta.source_status === "source_changed") {
		warnings.push("The source file changed after this layer was loaded. Reload the source to refresh it.")
	}
	if (meta.display_mode === "preview") {
		warnings.push(
			`Rendering a preview: ${Number(meta.preview_feature_count ?? 0).toLocaleString()} of ${Number(meta.original_feature_count ?? 0).toLocaleString()} features. The full data is kept for export.`,
		)
	}
	if (meta.simplified === "true") {
		warnings.push(
			`Auto-simplified: ${Number(meta.original_coord_count ?? 0).toLocaleString()} to ${Number(meta.simplified_coord_count ?? 0).toLocaleString()} coordinates (the file was very large).`,
		)
	}
	if (layer.layerType === "gee_tile" && meta.gee_mock === "true") warnings.push("Mock tile layer: not real Earth Engine data.")
	const note = intelligence.dataState === "unknown" ? `${intelligence.statusLabel}. ${intelligence.statusDetail}` : undefined
	return { warnings, note }
}

/** The one note every layer of a group shares, or undefined when they differ (or the group has a single layer). */
export function sharedNote(indicators: RowIndicators[]): string | undefined {
	if (indicators.length < 2) return undefined
	const first = indicators[0].note
	return first && indicators.every((i) => i.note === first) ? first : undefined
}

// ── duplicates ──────────────────────────────────────────────────────────────

/**
 * Two layers with the same key are the same thing: the same tool run and source drawn twice. Only layers that carry an
 * identity are compared (a run id, a tool, or a source path); anything else is never called a duplicate, because two
 * layers a user loaded by hand under one name may differ in ways this panel cannot see.
 */
/** A cheap string hash (djb2 over at most the first 200 000 characters, plus the full length). */
function hashText(text: string): string {
	let h = 5381
	const n = Math.min(text.length, 200_000)
	for (let i = 0; i < n; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
	return `${text.length}:${(h >>> 0).toString(36)}`
}

/**
 * What the layer actually draws: its geometry, raster bounds and source, tile URL, filter, time range and band. Two
 * layers from the same run and source that differ in any of these are not the same thing (a different filter or date
 * range on one dataset, a clipped copy), so they are never offered for removal as duplicates.
 */
export function contentFingerprint(layer: MapLayer): string {
	const m = layer.metadata ?? {}
	return [
		layer.geojson ? hashText(layer.geojson) : "",
		m.raster_bounds ?? "",
		m.raster_data_url ? hashText(m.raster_data_url) : "",
		m.raster_path ?? m.raster_source_path ?? "",
		m.raster_colormap ?? "",
		m.gee_tile_url_template ?? m.gee_remote_tile_url_template ?? "",
		m.gee_dataset_id ?? "",
		m.gee_start_date ?? m.time_start ?? "",
		m.gee_end_date ?? m.time_end ?? "",
		m.gee_bands ?? m.band ?? "",
		m.gee_filter ?? m.filter ?? "",
		m.gee_vis_params ?? "",
	].join("|")
}

export function duplicateKey(layer: MapLayer): string | null {
	const meta = layer.metadata ?? {}
	const run = layerRunId(meta)
	const tool = layerTool(meta)
	const path = meta.source_path || meta.path || meta.raster_source_path
	if (!run && !path) return null
	return [
		originOf(layer),
		layer.layerType ?? "",
		(meta.display_name || layer.name || "").trim().toLowerCase(),
		tool ?? "",
		run ?? "",
		meta.workspace_folder ?? "",
		path ?? "",
		contentFingerprint(layer),
	].join("\u0000")
}

/**
 * Layers to drop to leave one of each duplicate: the first in the list given stays (callers pass the list as the user
 * reads it, top of the map first), and a visible copy
 * wins over a hidden one so removing duplicates never hides what the user was looking at.
 */
export function duplicatesToRemove(layers: MapLayer[], visible: (id: string) => boolean): MapLayer[] {
	const byKey = new Map<string, MapLayer[]>()
	for (const layer of layers) {
		const key = duplicateKey(layer)
		if (key) byKey.set(key, [...(byKey.get(key) ?? []), layer])
	}
	const drop: MapLayer[] = []
	for (const copies of byKey.values()) {
		if (copies.length < 2) continue
		const keep = copies.find((c) => visible(c.id)) ?? copies[0]
		drop.push(...copies.filter((c) => c !== keep))
	}
	return drop
}

/** Ids that have at least one twin, for the row marker. */
export function duplicateIds(layers: MapLayer[]): Set<string> {
	const byKey = new Map<string, string[]>()
	for (const layer of layers) {
		const key = duplicateKey(layer)
		if (key) byKey.set(key, [...(byKey.get(key) ?? []), layer.id])
	}
	const ids = new Set<string>()
	for (const copies of byKey.values()) if (copies.length > 1) for (const id of copies) ids.add(id)
	return ids
}

// ── names ───────────────────────────────────────────────────────────────────

/** A short, readable id suffix for telling two same-named layers apart (a run id's first segment). */
export function shortRun(layer: MapLayer): string | undefined {
	return layerRunId(layer.metadata)?.split(".")[0]
}

// ── stacking ────────────────────────────────────────────────────────────────

/**
 * The order the map draws layers in. `layerOrder` is persisted draw order: the LAST id is drawn last, so it is on top
 * (MapView hands this order to deck.gl, and `sampleTopRasterAtPoint` scans it from the end). Layers not in
 * `layerOrder` follow, so they draw on top of listed ones. MapView and the Layers panel both use this one function.
 */
export function drawOrder(layers: MapLayer[], layerOrder: string[]): MapLayer[] {
	if (layerOrder.length === 0) return layers
	const byId = new Map(layers.map((l) => [l.id, l]))
	const sorted = layerOrder.map((id) => byId.get(id)).filter(Boolean) as MapLayer[]
	const listed = new Set(layerOrder)
	for (const l of layers) if (!listed.has(l.id)) sorted.push(l)
	return sorted
}

/** The Layers list reads like a GIS legend: the top row is on top of the map, so it is the draw order reversed. */
export const listOrder = (draw: MapLayer[]): MapLayer[] => [...draw].reverse()

/** Where a layer sits in the stack, 1 being on top of the map. Null when it is not in the list. */
export function stackPosition(draw: MapLayer[], id: string): { position: number; of: number } | null {
	const i = draw.findIndex((l) => l.id === id)
	return i < 0 ? null : { position: draw.length - i, of: draw.length }
}
