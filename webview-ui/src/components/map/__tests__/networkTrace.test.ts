import type { MapLayer } from "@shared/proto/cline/map"
import { describe, expect, it } from "vitest"
import { gaugeInfo } from "../gaugeInfo"
import {
	arrivedTrace,
	buildTracePrompt,
	describeTrace,
	parseTraceDistance,
	TRACE_FEATURE_CAP,
	TRACE_NATURE,
	traceAvailability,
	traceComposerText,
	traceLayerInfo,
	traceLayers,
} from "../networkTrace"

const lines = (direction: string, n: number) =>
	JSON.stringify({
		type: "FeatureCollection",
		features: Array.from({ length: n }, (_, i) => ({
			type: "Feature",
			properties: { nhdplus_comid: i, direction, length_km: 0.5 },
			geometry: {
				type: "LineString",
				coordinates: [
					[-70, 45],
					[-70.01, 45.01],
				],
			},
		})),
	})

const layer = (over: Partial<MapLayer> & { metadata?: Record<string, string> }): MapLayer =>
	({ id: "t1", name: "Upstream trace, 50 km, USGS-01013500 (NLDI)", layerType: "line", visible: true, ...over }) as MapLayer

const META = {
	tool: "gauge_flowlines",
	_run_id: "r1",
	study_id: "s1",
	source_path: "flowlines_01013500_upstream_50km_ab12cd34.geojson",
}

describe("parseTraceDistance", () => {
	it("takes whole km from 1 to 200 and refuses the rest, without rounding", () => {
		expect(parseTraceDistance(" 50 ")).toEqual({ km: 50 })
		expect(parseTraceDistance("1")).toEqual({ km: 1 })
		expect(parseTraceDistance("200")).toEqual({ km: 200 })
		for (const bad of ["", "0", "201", "12.5", "5e1", "-3", "abc", "1000"])
			expect(parseTraceDistance(bad)).toHaveProperty("error")
	})
})

describe("traceAvailability", () => {
	it("offers a trace for a USGS site number and says plainly when it cannot", () => {
		expect(traceAvailability(gaugeInfo({ site_no: "01013500" }, { source: "nwis" }) as never)).toEqual({ available: true })
		const mx = traceAvailability(gaugeInfo({ site_no: "08MF005" }, { source: "nwis" }) as never)
		expect(mx).toMatchObject({ available: false })
		expect(JSON.stringify(mx)).toContain("not a USGS site number")
		const unknownSource = traceAvailability(gaugeInfo({ site_no: "01013500" }, {}) as never)
		expect(unknownSource).toMatchObject({ available: false })
	})
})

describe("the request to the agent", () => {
	it("names the tool, the exact arguments, and what to do when the gauge is unavailable", () => {
		const p = buildTracePrompt("01013500", "upstream", 50)
		expect(p).toContain("`gauge_flowlines` with gauge_id='01013500', direction='upstream', distance_km=50")
		expect(p).toContain("available=false")
		expect(p).toContain("Do not add a layer")
		expect(p).toContain("not a modelled flow path")
		expect(p).toContain("map_add_layer_from_run")
		expect(p).not.toMatch(/https?:\/\//)
	})
	it("makes the line for an open chat carry the whole request", () => {
		const t = traceComposerText("01013500", "downstream", 120)
		expect(t).toContain("downstream 120 km")
		expect(t).toContain("01013500")
		expect(t).toContain("gauge_flowlines")
	})
})

describe("traceLayerInfo", () => {
	it("ignores any layer the trace tool did not make", () => {
		expect(traceLayerInfo(layer({ metadata: { tool: "delineate_watershed" } }))).toBeNull()
		expect(traceLayerInfo(layer({}))).toBeNull()
		expect(traceLayers([layer({}), layer({ id: "t2", metadata: META })]).map((t) => t.layerId)).toEqual(["t2"])
	})
	it("reads gauge, direction and distance from the tool's file name, and counts from the geometry", () => {
		const info = traceLayerInfo(layer({ metadata: META, geojson: lines("upstream", 12) }))
		expect(info).toMatchObject({
			siteNo: "01013500",
			direction: "upstream",
			distanceKm: 50,
			counts: { upstream: 12 },
			lengthKm: 6,
			truncated: "unknown",
			runId: "r1",
			studyId: "s1",
		})
	})
	it("says both when the geometry holds both directions", () => {
		const both = JSON.stringify({
			type: "FeatureCollection",
			features: [...JSON.parse(lines("upstream", 2)).features, ...JSON.parse(lines("downstream", 3)).features],
		})
		expect(traceLayerInfo(layer({ metadata: META, geojson: both }))?.direction).toBe("both")
	})
	it("does not guess when the geometry is not loaded", () => {
		const info = traceLayerInfo(layer({ metadata: META, geojson: "" }))
		expect(info?.counts).toBeUndefined()
		expect(info?.direction).toBe("upstream") // from the file name
		expect(info?.truncated).toBe("unknown")
		expect(traceLayerInfo(layer({ metadata: { tool: "gauge_flowlines" }, geojson: "{not json" }))?.direction).toBeUndefined()
	})
	it("marks a direction at the cap as possibly cut, and believes the tool's own truncated flag over a count", () => {
		expect(traceLayerInfo(layer({ metadata: META, geojson: lines("upstream", TRACE_FEATURE_CAP) }))?.truncated).toBe("at-cap")
		expect(
			traceLayerInfo(layer({ metadata: { ...META, truncated: "true" }, geojson: lines("upstream", 3) }))?.truncated,
		).toBe("yes")
		expect(
			traceLayerInfo(layer({ metadata: { ...META, truncated: "false" }, geojson: lines("upstream", 3) }))?.truncated,
		).toBe("no")
	})
})

describe("describeTrace", () => {
	it("states direction, distance, source and counts, always as a network query result", () => {
		const d = describeTrace(traceLayerInfo(layer({ metadata: META, geojson: lines("upstream", 12) }))!)
		expect(d.rows).toEqual([
			["Direction", "Upstream"],
			["Distance", "50 km along the network"],
			["Source", "NLDI navigation over NHDPlus V2"],
			["Flowlines", "12 upstream · 6 km"],
		])
		expect(d.notes).toEqual([TRACE_NATURE])
		expect(TRACE_NATURE).toContain("not a modelled flow path")
	})
	it("leads with the cut when the trace was cut or may have been", () => {
		const cut = describeTrace(
			traceLayerInfo(layer({ metadata: { ...META, truncated: "true" }, geojson: lines("upstream", 5) }))!,
		)
		expect(cut.notes[0]).toMatch(/^Cut short/)
		const cap = describeTrace(traceLayerInfo(layer({ metadata: META, geojson: lines("upstream", TRACE_FEATURE_CAP) }))!)
		expect(cap.notes[0]).toMatch(/may have been cut short/)
		expect(cap.notes).toHaveLength(2)
	})
	it("says not recorded for what the layer does not carry", () => {
		const d = describeTrace(traceLayerInfo(layer({ metadata: { tool: "gauge_flowlines" } }))!)
		expect(d.rows[0]).toEqual(["Direction", "not recorded"])
		expect(d.rows[1]).toEqual(["Distance", "not recorded"])
	})
})

describe("arrivedTrace", () => {
	it("is the new trace layer for the same gauge, not one that was already there", () => {
		const old = traceLayerInfo(layer({ id: "old", metadata: META }))!
		const fresh = traceLayerInfo(layer({ id: "new", metadata: META }))!
		const other = traceLayerInfo(
			layer({ id: "x", metadata: { ...META, source_path: "flowlines_09999999_upstream_50km_ab12cd34.geojson" } }),
		)!
		const req = { siteNo: "01013500", direction: "upstream" as const, distanceKm: 50, seenLayerIds: ["old"] }
		expect(arrivedTrace(req, [old])).toBeUndefined()
		expect(arrivedTrace(req, [old, other])).toBeUndefined()
		expect(arrivedTrace(req, [old, fresh])?.layerId).toBe("new")
	})
})
