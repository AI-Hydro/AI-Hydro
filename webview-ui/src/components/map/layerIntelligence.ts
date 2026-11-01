import { layerRetrievedAt, layerRunId, layerTool } from "@shared/map/provenanceEnvelope"
import type { MapLayer } from "@shared/proto/cline/map"

export type LayerDataState =
	| "raw_vector"
	| "analysis_ready_raster"
	| "visual_preview_raster"
	| "remote_raster"
	| "reference_vector"
	| "analysis_output"
	| "unknown"

export type LayerCapability =
	| "identify"
	| "hover_highlight"
	| "style_basic"
	| "style_graduated"
	| "style_raster"
	| "attributes"
	| "raster_probe"
	| "export_geojson"
	| "export_image"
	| "provenance"
	| "agent_context"
	| "plate_export"

export type LayerQualityWarning =
	| "VISUAL_PREVIEW_ONLY"
	| "CAPTURE_ONLY_EXPORT"
	| "MISSING_PROVENANCE"
	| "MISSING_CITATION"
	| "REMOTE_LAYER"
	| "UNSUPPORTED_SYMBOLOGY"

export interface LayerIntelligence {
	dataState: LayerDataState
	typeLabel: string
	statusLabel: string
	statusDetail: string
	capabilities: Set<LayerCapability>
	warnings: LayerQualityWarning[]
	provenancePath?: string
	citation?: string
	license?: string
	sourceLabel: string
}

interface DeriveOptions {
	rawRasterValuesAvailable?: boolean
}

const VECTOR_TYPES = new Set(["point", "line", "polygon", "vector", "geojson"])

export function deriveLayerIntelligence(layer: MapLayer, options: DeriveOptions = {}): LayerIntelligence {
	const meta = layer.metadata ?? {}
	const layerType = (layer.layerType ?? "").toLowerCase()
	const source = (meta.source ?? "").toLowerCase()
	const capabilities = new Set<LayerCapability>(["agent_context", "plate_export"])
	const warnings: LayerQualityWarning[] = []
	const provenancePath = meta.provenance_path || meta.provenancePath
	const citation = meta.citation || meta.dataset_citation || meta.merit_citation
	const license = meta.license || meta.dataset_license || meta.merit_license
	const isVector = VECTOR_TYPES.has(layerType) && Boolean(layer.geojson?.trim())
	const isMerit = source === "merit" || Boolean(meta.merit_layer)
	const isAnalysisOutput = Boolean(meta.tool || meta._run_id || source === "tool" || source === "session")
	const hasRawRaster =
		options.rawRasterValuesAvailable === true ||
		meta.raster_recolorable === "true" ||
		meta.raw_raster_values === "true" ||
		meta.raster_value_access === "raw"

	if (provenancePath) {
		capabilities.add("provenance")
	}
	if (!provenancePath && isAnalysisOutput) {
		warnings.push("MISSING_PROVENANCE")
	}

	if (isVector) {
		capabilities.add("identify")
		capabilities.add("hover_highlight")
		capabilities.add("style_basic")
		capabilities.add("attributes")
		capabilities.add("export_geojson")
		if (layerType !== "point") {
			capabilities.add("style_graduated")
		}
		if (isMerit && !citation) {
			warnings.push("MISSING_CITATION")
		}
		return {
			dataState: isMerit ? "reference_vector" : isAnalysisOutput ? "analysis_output" : "raw_vector",
			typeLabel: isMerit ? "Reference vector" : "Vector",
			statusLabel: isMerit ? "Reference data" : isAnalysisOutput ? "Analysis output" : "Editable vector",
			statusDetail: isMerit
				? "MERIT-Basins reference geometry; inspect provenance before publication."
				: "Feature geometry is available for identify, styling, attributes, and GeoJSON export.",
			capabilities,
			warnings,
			provenancePath,
			citation,
			license,
			sourceLabel: sourceLabel(layer),
		}
	}

	if (layerType === "raster") {
		capabilities.add("export_image")
		const hasSourceFile = Boolean(
			meta.raster_source_path || meta.source_raster_path || meta.source_tif_path || meta.twi_raster_path,
		)
		if (hasRawRaster) {
			capabilities.add("style_raster")
			capabilities.add("raster_probe")
			return {
				dataState: "analysis_ready_raster",
				typeLabel: "Raster",
				statusLabel: "Raster values available",
				statusDetail:
					"Raw raster values are available for styling and probing. Scientific validity, units and coverage require separate checks.",
				capabilities,
				warnings,
				provenancePath,
				citation,
				license,
				sourceLabel: sourceLabel(layer),
			}
		}
		if (hasSourceFile) {
			capabilities.add("style_raster")
			capabilities.add("raster_probe")
			return {
				dataState: "visual_preview_raster",
				typeLabel: "Raster",
				statusLabel: "Preview (GeoTIFF on disk)",
				statusDetail:
					"Map shows a rendered PNG overlay aligned to WGS84. Open Symbology → Load source to enable value probing and colormap editing from the workspace GeoTIFF.",
				capabilities,
				warnings,
				provenancePath: provenancePath || meta.raster_source_path || meta.workspace_path,
				citation,
				license,
				sourceLabel: sourceLabel(layer),
			}
		}
		warnings.push("VISUAL_PREVIEW_ONLY", "CAPTURE_ONLY_EXPORT")
		return {
			dataState: "visual_preview_raster",
			typeLabel: "Raster preview",
			statusLabel: "Visual preview only",
			statusDetail: "Only a rendered image is loaded. Load raster values to enable colormap editing and value probing.",
			capabilities,
			warnings,
			provenancePath,
			citation,
			license,
			sourceLabel: sourceLabel(layer),
		}
	}

	if (layerType === "gee_tile") {
		capabilities.add("export_image")
		warnings.push("REMOTE_LAYER", "CAPTURE_ONLY_EXPORT")
		return {
			dataState: "remote_raster",
			typeLabel: "Remote raster",
			statusLabel: "Remote raster layer",
			statusDetail: "Rendered from a remote tile service; export is capture-based unless a local artifact is generated.",
			capabilities,
			warnings,
			provenancePath,
			citation,
			license,
			sourceLabel: sourceLabel(layer),
		}
	}

	warnings.push("UNSUPPORTED_SYMBOLOGY")
	return {
		dataState: "unknown",
		typeLabel: layer.layerType || "Layer",
		statusLabel: "Limited layer",
		statusDetail: "AI-Hydro can show this layer, but advanced styling and export support are limited.",
		capabilities,
		warnings,
		provenancePath,
		citation,
		license,
		sourceLabel: sourceLabel(layer),
	}
}

export function warningText(warning: LayerQualityWarning): string {
	switch (warning) {
		case "VISUAL_PREVIEW_ONLY":
			return "Values not loaded"
		case "CAPTURE_ONLY_EXPORT":
			return "Capture-only export"
		case "MISSING_PROVENANCE":
			return "Missing provenance"
		case "MISSING_CITATION":
			return "Missing citation"
		case "REMOTE_LAYER":
			return "Remote layer"
		case "UNSUPPORTED_SYMBOLOGY":
			return "Limited styling"
	}
}

function sourceKnown(layer: MapLayer): boolean {
	const meta = layer.metadata ?? {}
	return Boolean(meta.source || meta.tool || meta.path)
}

function sourceLabel(layer: MapLayer): string {
	const meta = layer.metadata ?? {}
	const source = meta.source
	if (source === "gee") {
		return "Google Earth Engine"
	}
	if (source === "workspace") {
		return "Workspace"
	}
	if (source === "merit") {
		return "MERIT-Basins"
	}
	if (source === "nwis") {
		return "USGS NWIS"
	}
	if (source === "wbd") {
		return "USGS Watershed Boundary Dataset"
	}
	if (source === "nid") {
		return "National Inventory of Dams"
	}
	if (source === "user") {
		return "Loaded file"
	}
	if (meta.tool) {
		return meta.tool
	}
	if (meta.path) {
		return meta.path.split(/[\\/]/).pop() ?? meta.path
	}
	return "Map session"
}

export function sourceStatusText(status?: string): string {
	if (!status) return "Not checked"
	if (status === "source_changed") return "Source changed — reload recommended"
	if (status === "current") return "Reported current (not scientific validation)"
	return `Reported source status: ${status}`
}

export interface LayerProvenance {
	/** What is recorded, as label/value rows. */
	rows: Array<[string, string]>
	/** Labels of the facts that are not recorded, for the one "Not recorded" line. */
	notRecorded: string[]
}

/**
 * The Provenance tab: the facts that are recorded, then the ones that are not as a single list. Absence is
 * stated, but it does not take a row each. One row per fact: the run is the run (not "Run" and "Run ID"),
 * and the source file is the path (not "Source file" and "Path").
 */
export function layerProvenance(layer: MapLayer, intelligence: LayerIntelligence): LayerProvenance {
	const meta = layer.metadata ?? {}
	const tool = layerTool(meta)
	const run = layerRunId(meta)
	const timeRange = meta.time_start ? `${meta.time_start} – ${meta.time_end ?? "present"}` : undefined
	const facts: Array<[string, string | undefined]> = [
		// "Map session" is the fallback label when nothing names a source; it is not a recorded source.
		["Source", sourceKnown(layer) ? intelligence.sourceLabel : undefined],
		// The tool is the source for a tool layer; list it separately only when the two differ.
		["Tool", tool && tool !== intelligence.sourceLabel ? tool : undefined],
		["Run", run],
		["Computed at", layerRetrievedAt(meta)],
		["Agent step", meta.agent_step],
		["Source file", meta.source_display_path || meta.source_path || meta.path || meta.raster_source_path || meta.raster_path],
		["Format", meta.source_format || meta.format],
		["Converted artifact", meta.converted_artifact_path],
		["Claim", meta.claim_id],
		["File changed since run", meta._prior_run_id],
		["Provenance record", intelligence.provenancePath],
		["Product", meta.product_identity || meta.source_dataset_id || meta.gee_dataset_id || meta.dataset],
		["Units", meta.units],
		["CRS", meta.crs],
		["Time range", timeRange],
		["Citation", intelligence.citation],
		["License", intelligence.license],
		["Source status", meta.source_status ? sourceStatusText(meta.source_status) : undefined],
		["Validation", meta.validation_status],
		["Uncertainty", meta.uncertainty],
		["Coverage", meta.coverage_status],
	]
	// Hidden when absent (not "not recorded"): they only exist for some layers.
	// Run is not listed either: the Provenance tab says "No run record." on its own line.
	const optional = new Set([
		"Tool",
		"Run",
		"Claim",
		"File changed since run",
		"Agent step",
		"Format",
		"Converted artifact",
		"Time range",
		"Computed at",
	])
	const rows: Array<[string, string]> = []
	const notRecorded: string[] = []
	for (const [label, value] of facts) {
		if (value) {
			rows.push([label, value])
		} else if (!optional.has(label)) {
			notRecorded.push(label)
		}
	}
	return { rows, notRecorded }
}
