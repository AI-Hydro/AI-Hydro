/**
 * Trace upstream or downstream of a gauge: what the map asks for, and how a traced layer describes itself.
 *
 * The trace is a network query, not a model. `gauge_flowlines` asks NLDI which NHDPlus V2 flowlines lie within a
 * distance of the gauge along the network; it does not route water, and says nothing about regulation or gauge
 * coverage. The map never runs it: it asks the agent to (the same path as Delineate), so the call, its approval and
 * its run record are the chat's. The result is a layer the tool's run made, which `map_add_layer_from_run` puts in
 * Results. Nothing here looks anything up.
 *
 * The webview never traces over the loaded MERIT layer: that layer is clipped to the view, so the network is
 * incomplete and a trace over it would be silently wrong.
 */
import { layerRunId, layerTool } from "@shared/map/provenanceEnvelope"
import type { MapLayer } from "@shared/proto/cline/map"
import type { GaugeInfo } from "./gaugeInfo"

export const TRACE_TOOL = "gauge_flowlines"
export type TraceDirection = "upstream" | "downstream"
export const DEFAULT_TRACE_KM = 50
export const MIN_TRACE_KM = 1
export const MAX_TRACE_KM = 200
/** The tool keeps at most this many flowlines per direction. */
export const TRACE_FEATURE_CAP = 750
export const TRACE_SOURCE = "NLDI navigation over NHDPlus V2"
/** Said wherever a trace is described. */
export const TRACE_NATURE =
	"A network query result: the flowlines NLDI lists within this distance along the river network. It is not a modelled flow path, and says nothing about regulation or gauge coverage."

const DIRECTION_LABEL: Record<TraceDirection, string> = { upstream: "Upstream", downstream: "Downstream" }
export const directionLabel = (d: TraceDirection | "both"): string =>
	d === "both" ? "Upstream and downstream" : DIRECTION_LABEL[d]

/** A whole number from 1 to 200, or the reason it is not one. The field is text, so "5e1" and "12.5" are refused, not rounded. */
export function parseTraceDistance(raw: string): { km: number } | { error: string } {
	const text = raw.trim()
	if (!/^\d{1,3}$/.test(text)) return { error: `Distance is a whole number of km, ${MIN_TRACE_KM} to ${MAX_TRACE_KM}.` }
	const km = Number(text)
	if (km < MIN_TRACE_KM || km > MAX_TRACE_KM) {
		return { error: `Distance is a whole number of km, ${MIN_TRACE_KM} to ${MAX_TRACE_KM}.` }
	}
	return { km }
}

/**
 * Whether the map can offer a trace from this gauge. Only a USGS site number is traceable: the tool is NLDI, which
 * covers the United States. Whether NLDI knows a given US id is learned only by asking; the agent says so then.
 */
export function traceAvailability(gauge: GaugeInfo): { available: true } | { available: false; message: string } {
	if (!gauge.usgs || !/^\d{8,15}$/.test(gauge.siteNo)) {
		return {
			available: false,
			message: `Tracing needs a USGS gauge in the United States (NLDI). ${gauge.siteNo} is not a USGS site number, so nothing was looked up.`,
		}
	}
	return { available: true }
}

/** The request is text a model reads, so what goes into it is checked here, not trusted: a USGS site number and a whole km. */
function checkedRequest(siteNo: string, km: number): void {
	if (!/^\d{8,15}$/.test(siteNo)) throw new Error("A trace needs a USGS site number (8 to 15 digits).")
	if (!Number.isInteger(km) || km < MIN_TRACE_KM || km > MAX_TRACE_KM) {
		throw new Error(`A trace distance is a whole number of km, ${MIN_TRACE_KM} to ${MAX_TRACE_KM}.`)
	}
}

/** The one line that goes into an open chat's input. It carries the whole request: the user reads it and sends it. */
export function traceComposerText(siteNo: string, direction: TraceDirection, km: number): string {
	checkedRequest(siteNo, km)
	return `Trace ${direction} ${km} km from USGS gauge ${siteNo} (gauge_flowlines), then show it on the map:`
}

/** The layer name the agent is asked to use, so the Layers list says what the layer is without opening it. */
export function traceLayerName(siteNo: string, direction: TraceDirection, km: number): string {
	checkedRequest(siteNo, km)
	return `${directionLabel(direction)} trace, ${km} km, USGS-${siteNo} (NLDI)`
}

/** The prompt for a new chat. Same request as the composer line, with the steps and what to say about the result. */
export function buildTracePrompt(siteNo: string, direction: TraceDirection, km: number): string {
	checkedRequest(siteNo, km)
	const name = traceLayerName(siteNo, direction, km)
	return [
		`Trace the river network ${direction} of USGS gauge ${siteNo}, ${km} km along the network, and show the result on the map.`,
		"",
		"## Instructions",
		`1. Call the MCP tool \`${TRACE_TOOL}\` with gauge_id='${siteNo}', direction='${direction}', distance_km=${km}. Do NOT pass session_id: it is resolved from the chat context. Use no other tool or web request to get the network.`,
		"2. If the result has available=false (the gauge is outside the United States, or NLDI does not know it), tell the user so in plain words, give its message, and stop. Do not add a layer and do not guess a network.",
		"3. If the result is an error, report the code and message. Do not retry with other parameters unless the user asks.",
		`4. If it has a _run_id and a geometry_file, call \`map_add_layer_from_run\` with that run_id and layer_name='${name}'. If geometry_file is empty (no study), say that no layer could be added and that a study must be open; do not claim a layer.`,
		`5. Report: direction, distance_km, n_features_returned of n_features_total, and the source (${TRACE_SOURCE}). If truncated is true, say the trace was cut at ${TRACE_FEATURE_CAP} flowlines per direction and that the far end is missing. The layer carries gauge_id, direction, distance_km and truncated from the run, so do not rename or restyle it to say them.`,
		"6. Describe it as a network query result, not a modelled flow path. Do not say it shows where water goes, and do not say anything about dams or regulation from it.",
	].join("\n")
}

// ── what a traced layer says about itself ────────────────────────────────────

/**
 * What the tool recorded about the layer, as the layer envelope carries it (aihydro-tools `layer_meta`: `gauge_id`,
 * `direction`, `distance_km`, `truncated`, `n_features`). Nothing is read from the layer's name or file name and nothing is
 * inferred: a key an older tools server did not send reads "not recorded", and such a layer never answers a request.
 */
export interface TraceLayerInfo {
	layerId: string
	layerName: string
	siteNo?: string
	direction?: TraceDirection | "both"
	distanceKm?: number
	/** Flowlines the run kept, as the tool counted them. */
	nFeatures?: number
	/** The tool's own flag: true when its per-direction cap cut any direction. Undefined when the run did not say. */
	truncated?: boolean
	runId?: string
	studyId?: string
}

const wholeNumber = (v: string | undefined): number | undefined => (v && /^\d{1,9}$/.test(v) ? Number(v) : undefined)

/** A layer the trace tool made, described from its own metadata. Null for any other layer. */
export function traceLayerInfo(layer: MapLayer): TraceLayerInfo | null {
	const meta = layer.metadata ?? {}
	if (layerTool(meta) !== TRACE_TOOL) return null
	const site = meta.gauge_id
	const dir = meta.direction
	return {
		layerId: layer.id,
		layerName: layer.name,
		...(site && /^\d{8,15}$/.test(site) ? { siteNo: site } : {}),
		...(dir === "upstream" || dir === "downstream" || dir === "both" ? { direction: dir } : {}),
		...(wholeNumber(meta.distance_km) !== undefined ? { distanceKm: wholeNumber(meta.distance_km) } : {}),
		...(wholeNumber(meta.n_features) !== undefined ? { nFeatures: wholeNumber(meta.n_features) } : {}),
		...(meta.truncated === "true" ? { truncated: true } : meta.truncated === "false" ? { truncated: false } : {}),
		runId: layerRunId(meta),
		studyId: meta.study_id || meta.session_id || undefined,
	}
}

/** The traced layers on the map, in map order. */
export function traceLayers(layers: MapLayer[]): TraceLayerInfo[] {
	return layers.flatMap((l) => {
		const info = traceLayerInfo(l)
		return info ? [info] : []
	})
}

/** The rows a result block shows. Every line is something the tool recorded; the rest reads "not recorded". */
export function describeTrace(info: TraceLayerInfo): {
	title: string
	rows: Array<[string, string]>
	cut?: string
	notes: string[]
} {
	const rows: Array<[string, string]> = [
		["Direction", info.direction ? directionLabel(info.direction) : "not recorded"],
		["Distance", info.distanceKm !== undefined ? `${info.distanceKm} km along the network` : "not recorded"],
		["Source", TRACE_SOURCE],
		["Flowlines", info.nFeatures !== undefined ? String(info.nFeatures) : "not recorded"],
		["Cut short", info.truncated === undefined ? "not recorded" : info.truncated ? "yes" : "no"],
	]
	return {
		title: info.layerName,
		rows,
		...(info.truncated
			? {
					cut: `Cut short: the tool keeps at most ${TRACE_FEATURE_CAP} flowlines per direction and stopped there. The far end is missing.`,
				}
			: {}),
		notes: [TRACE_NATURE],
	}
}

// ── waiting for the layer ────────────────────────────────────────────────────

/** A trace the user asked the agent for, until its layer arrives or they stop waiting. */
export interface TraceRequest {
	siteNo: string
	direction: TraceDirection
	distanceKm: number
	/** Trace layers already on the map when it was asked: a layer in this set is not the answer. */
	seenLayerIds: string[]
}

/** The layer that answers a request: new, and recorded by the tool as this gauge, direction and distance. */
export function arrivedTrace(request: TraceRequest, traces: TraceLayerInfo[]): TraceLayerInfo | undefined {
	return traces.find(
		(t) =>
			t.siteNo === request.siteNo &&
			t.direction === request.direction &&
			t.distanceKm === request.distanceKm &&
			!request.seenLayerIds.includes(t.layerId),
	)
}
