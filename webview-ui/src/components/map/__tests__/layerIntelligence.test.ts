import type { MapLayer } from "@shared/proto/cline/map"
import { describe, expect, it } from "vitest"
import { deriveLayerIntelligence, layerProvenance, sourceStatusText } from "../layerIntelligence"

const layer = (partial: Partial<MapLayer> & Pick<MapLayer, "id" | "layerType">): MapLayer => ({
	id: partial.id,
	name: partial.name ?? partial.id,
	layerType: partial.layerType,
	geojson: partial.geojson ?? "",
	metadata: partial.metadata ?? {},
	style: partial.style,
	visible: partial.visible ?? true,
})

describe("deriveLayerIntelligence", () => {
	it("describes raw values without certifying scientific readiness", () => {
		const intel = deriveLayerIntelligence(
			layer({
				id: "twi",
				layerType: "raster",
				metadata: { raster_recolorable: "true", units: "index" },
			}),
		)
		expect(intel.dataState).toBe("analysis_ready_raster")
		expect(intel.statusLabel).toBe("Raster values available")
		expect(intel.capabilities.has("style_raster")).toBe(true)
		expect(intel.capabilities.has("raster_probe")).toBe(true)
		expect(intel.warnings).not.toContain("VISUAL_PREVIEW_ONLY")
	})

	it("explains rendered raster previews as visual-only", () => {
		const intel = deriveLayerIntelligence(layer({ id: "png", layerType: "raster" }))
		expect(intel.dataState).toBe("visual_preview_raster")
		expect(intel.statusLabel).toBe("Visual preview only")
		expect(intel.capabilities.has("style_raster")).toBe(false)
		expect(intel.warnings).toContain("VISUAL_PREVIEW_ONLY")
		expect(intel.warnings).toContain("CAPTURE_ONLY_EXPORT")
	})

	it("recognizes MERIT vectors as reference data with citation warnings", () => {
		const intel = deriveLayerIntelligence(
			layer({
				id: "merit-cat",
				layerType: "polygon",
				geojson: "{}",
				metadata: { source: "merit", merit_layer: "catchments" },
			}),
		)
		expect(intel.dataState).toBe("reference_vector")
		expect(intel.statusLabel).toBe("Reference data")
		expect(intel.capabilities.has("export_geojson")).toBe(true)
		expect(intel.warnings).toContain("MISSING_CITATION")
	})
})

describe("research inspection", () => {
	const provenanceOf = (l: ReturnType<typeof layer>) => layerProvenance(l, deriveLayerIntelligence(l))
	it("keeps unrecorded scientific support unknown, as one list and not one row each", () => {
		const { rows, notRecorded } = provenanceOf(layer({ id: "missing", layerType: "raster" }))
		const labels = rows.map(([k]) => k)
		expect(labels).not.toContain("Units")
		expect(labels).not.toContain("Validation")
		expect(notRecorded).toEqual(expect.arrayContaining(["Units", "CRS", "Validation", "Uncertainty", "Run", "Source status"]))
		// Recorded facts stay; absent optional fields are not listed at all.
		expect(labels).toEqual(["Source"])
		expect(notRecorded).not.toContain("Agent step")
	})
	it("does not call provisional or unfamiliar sources current", () => {
		expect(sourceStatusText("provisional")).toBe("Reported source status: provisional")
		expect(sourceStatusText("source_changed")).toContain("reload recommended")
		expect(sourceStatusText("future_status")).toContain("future_status")
	})
	it("retains product and run identity for inspection, one row per fact", () => {
		const { rows, notRecorded } = provenanceOf(
			layer({
				id: "rain",
				layerType: "raster",
				metadata: {
					units: "mm/day",
					product_identity: '{"dataset_version":"3.0"}',
					_run_id: "run-1",
					tool: "fetch_rain",
					path: "/w/rain.tif",
					source_path: "/w/rain.tif",
				},
			}),
		)
		const byLabel = Object.fromEntries(rows)
		expect(byLabel.Units).toBe("mm/day")
		expect(byLabel.Run).toBe("run-1")
		expect(byLabel.Product).toContain("3.0")
		expect(byLabel["Source file"]).toBe("/w/rain.tif")
		expect(rows.filter(([k]) => k === "Run" || k === "Run ID").length).toBe(1)
		expect(rows.filter(([k]) => k === "Path").length).toBe(0)
		expect(notRecorded).not.toContain("Units")
		expect(notRecorded).not.toContain("Run")
	})
	it("names the tool apart from the source only when they differ", () => {
		const same = provenanceOf(
			layer({ id: "a", layerType: "polygon", geojson: "{}", metadata: { tool: "delineate_watershed" } }),
		)
		expect(same.rows.map(([k]) => k)).not.toContain("Tool")
		const differs = provenanceOf(
			layer({ id: "b", layerType: "polygon", geojson: "{}", metadata: { tool: "t", source: "merit" } }),
		)
		expect(differs.rows.map(([k]) => k)).toContain("Tool")
	})
})
