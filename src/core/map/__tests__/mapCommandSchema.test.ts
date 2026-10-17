import { expect } from "chai"
import { describe, it } from "mocha"
import { mapCommandSchema } from "../mapCommandSchema"

describe("mapCommandSchema", () => {
	it("accepts a well-formed update_layer command", () => {
		const result = mapCommandSchema.safeParse({
			type: "update_layer",
			layer_id: "layer1",
			visible: true,
			style: { color: "#ff0000", weight: 2 },
			metadata: { source: "agent" },
		})
		expect(result.success).to.equal(true)
	})

	it("accepts a well-formed set_roi command", () => {
		const result = mapCommandSchema.safeParse({
			type: "set_roi",
			roi: { id: "r1", name: "test", geojson: "{}", area_ha: 12.5 },
		})
		expect(result.success).to.equal(true)
	})

	it("rejects a command missing the required type field", () => {
		const result = mapCommandSchema.safeParse({ layer_id: "layer1" })
		expect(result.success).to.equal(false)
	})

	it("rejects wrong-typed fields instead of silently coercing", () => {
		// visible must be boolean — a string here previously would have
		// flowed straight into MapLayerPatch via an unchecked `as` cast.
		const result = mapCommandSchema.safeParse({ type: "set_layer_visibility", layer_id: "x", visible: "yes" })
		expect(result.success).to.equal(false)
	})

	it("rejects prototype-pollution-shaped roi payloads", () => {
		const result = mapCommandSchema.safeParse({
			type: "set_roi",
			roi: { id: "r1", area_ha: "not-a-number" },
		})
		expect(result.success).to.equal(false)
	})

	describe("agent-native map control commands", () => {
		it("accepts a well-formed fly_to command and preserves its fields", () => {
			const result = mapCommandSchema.safeParse({
				type: "fly_to",
				longitude: -86.9,
				latitude: 40.4,
				zoom: 9,
				duration_ms: 2000,
			})
			expect(result.success).to.equal(true)
			if (result.success) {
				expect(result.data.longitude).to.equal(-86.9)
				expect(result.data.latitude).to.equal(40.4)
				expect(result.data.zoom).to.equal(9)
				expect(result.data.duration_ms).to.equal(2000)
			}
		})

		it("rejects out-of-range or non-numeric fly_to coordinates", () => {
			expect(mapCommandSchema.safeParse({ type: "fly_to", longitude: 181, latitude: 0 }).success).to.equal(false)
			expect(mapCommandSchema.safeParse({ type: "fly_to", longitude: 0, latitude: -91 }).success).to.equal(false)
			expect(mapCommandSchema.safeParse({ type: "fly_to", longitude: "0", latitude: 0 }).success).to.equal(false)
			expect(mapCommandSchema.safeParse({ type: "fly_to", longitude: 0, latitude: 0, zoom: 25 }).success).to.equal(false)
			expect(mapCommandSchema.safeParse({ type: "fly_to", longitude: 0, latitude: 0, zoom: -1 }).success).to.equal(false)
		})

		it("caps fly_to duration", () => {
			expect(
				mapCommandSchema.safeParse({ type: "fly_to", longitude: 0, latitude: 0, duration_ms: 60_000 }).success,
			).to.equal(true)
			expect(
				mapCommandSchema.safeParse({ type: "fly_to", longitude: 0, latitude: 0, duration_ms: 60_001 }).success,
			).to.equal(false)
			expect(mapCommandSchema.safeParse({ type: "fly_to", longitude: 0, latitude: 0, duration_ms: -1 }).success).to.equal(
				false,
			)
		})

		it("accepts add_layer_from_run and bounds identifier lengths", () => {
			const ok = mapCommandSchema.safeParse({
				type: "add_layer_from_run",
				layer_id: "run_layer",
				layer_name: "Run output",
				geojson: '{"type":"FeatureCollection","features":[]}',
				run_id: "run-1",
				session_id: "s-1",
				auto_zoom: true,
			})
			expect(ok.success).to.equal(true)
			expect(mapCommandSchema.safeParse({ type: "add_layer_from_run", run_id: "x".repeat(257) }).success).to.equal(false)
			expect(mapCommandSchema.safeParse({ type: "add_layer_from_run", session_id: "x".repeat(257) }).success).to.equal(
				false,
			)
			expect(mapCommandSchema.safeParse({ type: "add_layer_from_run", layer_name: "x".repeat(513) }).success).to.equal(
				false,
			)
			expect(mapCommandSchema.safeParse({ type: "add_layer_from_run", auto_zoom: "yes" }).success).to.equal(false)
		})

		it("accepts set_time_range ISO timestamps and rejects garbage", () => {
			const ok = mapCommandSchema.safeParse({
				type: "set_time_range",
				start_iso: "2020-01-01T00:00:00Z",
				end_iso: "2020-12-31",
			})
			expect(ok.success).to.equal(true)
			if (ok.success) {
				expect(ok.data.start_iso).to.equal("2020-01-01T00:00:00Z")
			}
			expect(mapCommandSchema.safeParse({ type: "set_time_range", start_iso: "not-a-date" }).success).to.equal(false)
			expect(
				mapCommandSchema.safeParse({ type: "set_time_range", start_iso: "2020-01-01T00:00:00+05:30" }).success,
			).to.equal(true)
			// Looser formats Date.parse would accept are refused.
			expect(mapCommandSchema.safeParse({ type: "set_time_range", start_iso: "Jan 5 2020" }).success).to.equal(false)
			expect(mapCommandSchema.safeParse({ type: "set_time_range", start_iso: "2020-01-01 junk" }).success).to.equal(false)
			expect(
				mapCommandSchema.safeParse({ type: "set_time_range", start_iso: "2021-01-01", end_iso: "2020-01-01" }).success,
			).to.equal(false)
			expect(mapCommandSchema.safeParse({ type: "fit_layer", layer_id: "x".repeat(257) }).success).to.equal(false)
			expect(mapCommandSchema.safeParse({ type: "set_time_range", start_iso: "2".repeat(65) }).success).to.equal(false)
			expect(mapCommandSchema.safeParse({ type: "set_time_range", end_iso: 12345 }).success).to.equal(false)
		})
	})
})
