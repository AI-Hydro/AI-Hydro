/**
 * A reference to a thing on the map, small enough to put in a chat message as one line.
 *
 * "Ask AI-Hydro" from the map used to send a long prompt that described the click (twelve properties, no layer id,
 * no run id). The agent got a description, not a reference. A MapRef names the layer, the run and the study, so the
 * agent can ask the map about the named layer (`map_get_state`) instead of reading a paraphrase of it. Whether the
 * agent resolves a ref correctly is not measured; `map_get_item`, which would fetch one object, does not exist yet.
 */

export type MapRefKind = "gauge" | "river" | "basin" | "feature" | "pin" | "empty"

export interface MapRef {
	kind: MapRefKind
	layer_id?: string
	layer_name?: string
	run_id?: string
	study_id?: string
	feature_key?: string
	lon?: number
	lat?: number
	/** A raster value or one property value the click read, as text. */
	value?: string
}

const KINDS: ReadonlySet<string> = new Set(["gauge", "river", "basin", "feature", "pin", "empty"])
/** What an id may contain. Anything else is dropped, never repaired: the line is read by a model and by a person. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const MAX_TEXT = 120

/** Control, zero-width, separator and bidi-control characters: invisible, so they can hide or reorder text. */
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g
export const stripInvisible = (value: string): string => value.replace(INVISIBLE, " ")

const text = (value: unknown): string | undefined => {
	if (typeof value !== "string") return undefined
	const clean = stripInvisible(value)
		.replace(/[\][]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, MAX_TEXT)
	return clean || undefined
}
const id = (value: unknown): string | undefined => (typeof value === "string" && ID.test(value) ? value : undefined)
const coord = (value: unknown, limit: number): number | undefined =>
	typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit ? value : undefined

/** Validate a ref that came from a webview. Returns undefined when it names nothing usable. */
export function parseMapRef(raw: unknown): MapRef | undefined {
	if (!raw || typeof raw !== "object") return undefined
	const r = raw as Record<string, unknown>
	const kind = typeof r.kind === "string" && KINDS.has(r.kind) ? (r.kind as MapRefKind) : undefined
	if (!kind) return undefined
	const ref: MapRef = { kind }
	const layer_id = id(r.layer_id)
	const run_id = id(r.run_id)
	const study_id = id(r.study_id)
	const feature_key = text(r.feature_key)
	const layer_name = text(r.layer_name)
	const value = text(r.value)
	const lon = coord(r.lon, 180)
	const lat = coord(r.lat, 90)
	if (layer_id) ref.layer_id = layer_id
	if (layer_name) ref.layer_name = layer_name
	if (run_id) ref.run_id = run_id
	if (study_id) ref.study_id = study_id
	if (feature_key) ref.feature_key = feature_key
	if (lon !== undefined && lat !== undefined) {
		ref.lon = lon
		ref.lat = lat
	}
	if (value) ref.value = value
	return ref
}

/** One line, `[map-ref key=value ...]`. Values with a space are quoted. Stable key order. */
export function formatMapRef(ref: MapRef): string {
	const parts: string[] = [`kind=${ref.kind}`]
	const add = (key: string, value: string | number | undefined) => {
		if (value === undefined || value === "") return
		const s = String(value)
		parts.push(/\s/.test(s) ? `${key}="${s.replace(/"/g, "'")}"` : `${key}=${s}`)
	}
	add("layer", ref.layer_id)
	add("name", ref.layer_name)
	add("run", ref.run_id)
	add("study", ref.study_id)
	add("feature", ref.feature_key)
	if (ref.lon !== undefined && ref.lat !== undefined) add("at", `${ref.lon.toFixed(5)},${ref.lat.toFixed(5)}`)
	add("value", ref.value)
	return `[map-ref ${parts.join(" ")}]`
}
