import type { MapLayer } from "@shared/proto/cline/map"
import { afterEach, expect, it, vi } from "vitest"
import { buildSnapshot, evaluateReadiness, inferColorRamp } from "../MapExport"
import { exportLayerMetadata, freezeMapCanvas } from "../mapCapture"

vi.mock("../../../services/grpc-client", () => ({ MapServiceClient: {} }))
afterEach(() => vi.restoreAllMocks())
const spec = {
	template: "report",
	dpi: 150,
	extentStrategy: "preserve-visible-extent",
	elements: { attribution: true },
} as Parameters<typeof buildSnapshot>[0]
const raster = (metadata: Record<string, string> = {}) =>
	buildSnapshot(spec, { layers: [{ id: "a", name: "NDVI flood elevation", layerType: "raster", metadata } as MapLayer] })
		.layers[0]
it("never guesses a raster palette or numeric range from its name", () => {
	expect(inferColorRamp(raster())).toBeNull()
	expect(inferColorRamp(raster({ raster_colormap: "viridis" }))).toBeNull()
	expect(inferColorRamp(raster({ raster_colormap: "unknown", min: "0", max: "1" }))).toBeNull()
	expect(inferColorRamp(raster({ raster_colormap: "viridis", min: "0junk", max: "1" }))).toBeNull()
})
it("retains declared nonuniform positions and rejects malformed scales", () => {
	const legend = {
		type: "continuous",
		stops: [
			[0, "#000000"],
			[0.2, "#aaaaaa"],
			[1, "#ffffff"],
		],
		min: 0,
		max: 50,
		units: "mm",
	}
	expect(inferColorRamp(raster({ legend: JSON.stringify(legend) }))).toMatchObject({
		positions: [0, 0.2, 1],
		min: 0,
		max: 50,
		units: "mm",
	})
	for (const change of [
		{ stops: [[0, "#000000"]] },
		{
			stops: [
				[1, "#000000"],
				[0, "#ffffff"],
			],
		},
		{ max: -1 },
		{ min: null },
		{ stops: undefined, colormap: "unknown" },
	]) {
		expect(inferColorRamp(raster({ legend: JSON.stringify({ ...legend, ...change }) }))).toBeNull()
	}
})
it("captures current visibility, opacity, actual citation and provenance without image payloads", () => {
	const snapshot = buildSnapshot(spec, {
		visibleLayerIds: new Set(["a"]),
		layerOpacities: { a: 0.3 },
		layers: [
			{
				id: "a",
				name: "Study",
				layerType: "raster",
				visible: false,
				style: { opacity: 1 },
				metadata: {
					units: "mm",
					citation: "Recorded citation",
					provenance_path: "/study/run.json",
					raster_data_url: "data:large",
					gee_tile_url_template: "secret",
				},
			} as unknown as MapLayer,
			{ id: "hidden", name: "Hidden", visible: true } as MapLayer,
		],
	})
	expect(snapshot.layers).toHaveLength(1)
	expect(snapshot.layers[0]).toMatchObject({
		opacity: 0.3,
		sourceRef: "/study/run.json",
		metadata: { units: "mm", citation: "Recorded citation" },
	})
	expect(JSON.stringify(snapshot)).not.toContain("data:large")
	expect(JSON.stringify(snapshot)).not.toContain("secret")
	expect(snapshot.citations).toContainEqual({ id: "a", label: "Study", text: "Recorded citation" })
})
it("blocks research export on imagery failure while retaining diagnostic capture", () => {
	const snapshot = buildSnapshot(spec, {})
	const canvas = { width: 2000, height: 2000 } as HTMLCanvasElement
	expect(evaluateReadiness(spec, snapshot, canvas, ["Tile failed"])).toMatchObject({
		canQuickExport: true,
		canResearchExport: false,
		blockingReasons: ["Tile failed"],
	})
	expect(evaluateReadiness(spec, snapshot, canvas, [])).toMatchObject({
		qualityStatus: "with-warnings",
		canResearchExport: true,
	})
	expect(evaluateReadiness(spec, snapshot, canvas).canResearchExport).toBe(false)
})
it("copies pixels synchronously into a distinct canvas and rejects empty captures", () => {
	const source = document.createElement("canvas")
	source.width = 640
	source.height = 480
	const drawImage = vi.fn()
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
	const frozen = freezeMapCanvas(source)
	expect(frozen).not.toBe(source)
	expect([frozen.width, frozen.height]).toEqual([640, 480])
	expect(drawImage).toHaveBeenCalledWith(source, 0, 0)
	source.width = 0
	expect(() => freezeMapCanvas(source)).toThrow("no rendered pixels")
})
it("keeps scientific metadata while excluding transport fields", () => {
	expect(exportLayerMetadata({ product_identity: "identity", uncertainty: "unknown", raster_data_url: "image" })).toEqual({
		product_identity: "identity",
		uncertainty: "unknown",
	})
})
it("uses actual line geometry and stroke despite a misleading basin name", () => {
	const snapshot = buildSnapshot(spec, {
		layers: [
			{
				id: "a",
				name: "basin polygon",
				layerType: "geojson",
				geojson: JSON.stringify({
					type: "LineString",
					coordinates: [
						[0, 0],
						[1, 1],
					],
				}),
				style: { fillColor: "#ff0000", strokeColor: "#0000ff" },
			} as MapLayer,
		],
	})
	expect(snapshot.layers[0]).toMatchObject({ geom: "line", color: "#0000ff", opacity: 1 })
})
