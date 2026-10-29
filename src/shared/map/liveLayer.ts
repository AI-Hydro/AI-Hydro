import type { MapLayer } from "@shared/proto/cline/map"
import { layerRetrievedAt, layerRunId, layerTool } from "./provenanceEnvelope"

/** WGS84 bounding box: [west, south, east, north] */
export type LayerBounds = [number, number, number, number]

export type LegendSpec =
	| {
			type: "continuous"
			title?: string
			units?: string
			min?: number
			max?: number
			colormap?: string
			stops?: Array<[number, string]>
	  }
	| {
			type: "categorical"
			title?: string
			classes: Array<{ value: string | number; label: string; color: string }>
	  }

/**
 * View model aligned with the planned backend LiveLayer contract.
 * Built from wire-format MapLayer + metadata conventions (no proto change in slice 1).
 */
export interface LiveLayer {
	id: string
	name: string
	layerType: string
	visible: boolean
	opacity: number
	bounds?: LayerBounds
	legend?: LegendSpec
	provenancePath?: string
	source?: string
	geeDatasetId?: string
	geeStartDate?: string
	geeEndDate?: string
	geeMock?: boolean
	// Phase 3.4 — provenance chips
	toolName?: string // metadata.tool — MCP tool that created this layer
	runId?: string // metadata._run_id   — enforcement run_id
	agentStep?: string // metadata.agent_step — agent step index/label
	computedAt?: string // metadata.retrieved_at — ISO timestamp of computation
	// Phase 3.4 — time slider
	timeStart?: string // metadata.time_start — ISO date / YYYY-MM-DD
	timeEnd?: string // metadata.time_end   — ISO date / YYYY-MM-DD
	// Phase 3.4 — claim binding
	boundClaimId?: string // metadata.claim_id   — linked claim in the ledger
}

export function parseBoundsJson(raw?: string): LayerBounds | undefined {
	if (!raw) {
		return undefined
	}
	try {
		const b = JSON.parse(raw) as number[]
		if (b.length === 4 && b.every((v) => Number.isFinite(v))) {
			return [b[0], b[1], b[2], b[3]]
		}
	} catch {
		/* ignore */
	}
	return undefined
}

export function mapLayerToLiveLayer(layer: MapLayer): LiveLayer {
	const meta = layer.metadata ?? {}
	const bounds = parseBoundsJson(meta.gee_bounds) ?? parseBoundsJson(meta.raster_bounds)

	let opacity = layer.style?.opacity ?? 1
	if (meta.raster_opacity) {
		const parsed = parseFloat(meta.raster_opacity)
		if (Number.isFinite(parsed)) {
			opacity = parsed
		}
	}

	let legend: LegendSpec | undefined
	if (meta.legend) {
		try {
			legend = JSON.parse(meta.legend) as LegendSpec
		} catch {
			legend = undefined
		}
	}

	return {
		id: layer.id,
		name: layer.name,
		layerType: layer.layerType,
		visible: layer.visible,
		opacity,
		bounds,
		legend,
		provenancePath: meta.provenance_path,
		source: meta.source,
		geeDatasetId: meta.gee_dataset_id,
		geeStartDate: meta.gee_start_date,
		geeEndDate: meta.gee_end_date,
		geeMock: meta.gee_mock === "true",
		toolName: layerTool(meta),
		runId: layerRunId(meta),
		agentStep: meta.agent_step,
		computedAt: layerRetrievedAt(meta),
		timeStart: meta.time_start,
		timeEnd: meta.time_end,
		boundClaimId: meta.claim_id,
	}
}
