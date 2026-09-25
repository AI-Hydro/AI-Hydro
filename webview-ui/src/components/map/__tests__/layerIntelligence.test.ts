import type { MapLayer } from "@shared/proto/cline/map"
import { describe, expect, it } from "vitest"
import { deriveLayerIntelligence, layerResearchDetails, sourceStatusText } from "../layerIntelligence"

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
	it("keeps unrecorded scientific support unknown", () => {
		const rows = Object.fromEntries(layerResearchDetails(layer({ id: "missing", layerType: "raster" })))
		expect(rows["Source status"]).toBe("Not checked")
		expect(rows.Validation).toBe("Not assessed")
		expect(rows.Units).toBe("Not recorded")
	})
	it("does not call provisional or unfamiliar sources current", () => {
		expect(sourceStatusText("provisional")).toBe("Reported source status: provisional")
		expect(sourceStatusText("source_changed")).toContain("reload recommended")
		expect(sourceStatusText("future_status")).toContain("future_status")
	})
	it("retains product and run identity for inspection", () => {
		const rows = Object.fromEntries(
			layerResearchDetails(
				layer({
					id: "rain",
					layerType: "raster",
					metadata: {
						units: "mm/day",
						product_identity: '{"dataset_version":"3.0"}',
						_run_id: "run-1",
					},
				}),
			),
		)
		expect(rows.Units).toBe("mm/day")
		expect(rows.Run).toBe("run-1")
		expect(rows["Product identity"]).toContain("3.0")
	})
})
