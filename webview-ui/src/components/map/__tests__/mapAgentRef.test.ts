import type { MapLayer } from "@shared/proto/cline/map"
import { describe, expect, it } from "vitest"
import { buildMapRef } from "../mapAgentRef"

const layers = [
	{ id: "g", name: "Gauges", metadata: { _run_id: "run-2.1", study_id: "s1" } },
	{ id: "o", name: "Old", metadata: { session_id: "legacy-study" } },
] as unknown as MapLayer[]

describe("buildMapRef", () => {
	it("names the layer, run, study, feature id and place of what was clicked", () => {
		const ref = buildMapRef({
			point: { lon: -68.5, lat: 47.2 },
			features: [{ layerId: "g", layerName: "Gauges", properties: { site_no: "01013500" } }],
			layers,
		})
		expect(ref).toEqual({
			kind: "gauge",
			layer_id: "g",
			layer_name: "Gauges",
			run_id: "run-2.1",
			study_id: "s1",
			feature_key: "01013500",
			lon: -68.5,
			lat: 47.2,
		})
	})

	it("falls back to the catalogue session id, and never invents a key from geometry", () => {
		const ref = buildMapRef({
			point: { lon: 1, lat: 2 },
			features: [
				{ layerId: "o", layerName: "Old", properties: { depth: 3 }, geometry: { type: "Point", coordinates: [1, 2] } },
			],
			layers,
		})
		expect(ref.study_id).toBe("legacy-study")
		expect(ref.feature_key).toBeUndefined()
		expect(ref.run_id).toBeUndefined()
	})

	it("is an empty point with no features, and a pin when given a pin id", () => {
		expect(buildMapRef({ point: { lon: 1, lat: 2 }, features: [], layers }).kind).toBe("empty")
		const pin = buildMapRef({ point: { lon: 1, lat: 2 }, features: [], layers, pinId: "pin_1" })
		expect(pin).toMatchObject({ kind: "pin", feature_key: "pin_1" })
	})
})
