import type { MapLayer } from "@shared/proto/cline/map"
import { describe, expect, it } from "vitest"
import {
	drawOrder,
	duplicateIds,
	duplicateKey,
	duplicatesToRemove,
	groupLayers,
	listOrder,
	openableRun,
	originOf,
	rowIndicators,
	sharedNote,
	stackPosition,
} from "../layerModel"

const layer = (id: string, over: Partial<MapLayer> = {}, metadata: Record<string, string> = {}): MapLayer =>
	({
		id,
		name: id,
		layerType: "polygon",
		visible: true,
		geojson: '{"type":"FeatureCollection","features":[]}',
		metadata,
		...over,
	}) as MapLayer

describe("origin and groups", () => {
	it("classifies by recorded origin, with a run or tool meaning tool output", () => {
		expect(originOf(layer("a", {}, { tool: "delineate_watershed" }))).toBe("tool")
		expect(originOf(layer("b", {}, { _run_id: "run-1.1" }))).toBe("tool")
		expect(originOf(layer("c", {}, { source: "workspace" }))).toBe("workspace")
		expect(originOf(layer("d", {}, { source: "user" }))).toBe("user")
		expect(originOf(layer("e", {}, { source: "gee" }))).toBe("gee")
		expect(originOf(layer("f"))).toBe("pushed")
	})

	it("classes MERIT, NWIS, WBD and NID layers as reference data, unless a run made them", () => {
		for (const source of ["merit", "nwis", "wbd", "nid"]) {
			expect(originOf(layer(source, {}, { source }))).toBe("reference")
			expect(originOf(layer(`${source}-run`, {}, { source, _run_id: "run-3.1", study_id: "s1" }))).toBe("tool")
		}
		expect(groupLayers([layer("a", {}, { source: "wbd" })]).map((g) => g.origin)).toEqual(["reference"])
	})

	it("a tool-made layer from a reference source with no run is Tool output, not Reference data", () => {
		expect(originOf(layer("t", {}, { source: "nwis", tool: "fetch_gauges" }))).toBe("tool")
		expect(originOf(layer("m", {}, { source: "merit", tool: "extract_rivers" }))).toBe("tool")
	})

	it("opens a run only when the layer names both its study and its run", () => {
		expect(openableRun(layer("a", {}, { _run_id: "run-1.1", study_id: "s1" }))).toEqual({ studyId: "s1", runId: "run-1.1" })
		expect(openableRun(layer("b", {}, { _run_id: "run-1.1" }))).toBeNull()
		expect(openableRun(layer("c", {}, { study_id: "s1" }))).toBeNull()
		expect(openableRun(layer("d"))).toBeNull()
	})

	it("buckets in a fixed group order and keeps map order inside a group", () => {
		const groups = groupLayers([
			layer("w1", {}, { source: "workspace" }),
			layer("t1", {}, { tool: "x" }),
			layer("u1", {}, { source: "user" }),
			layer("t2", {}, { tool: "y" }),
		])
		expect(groups.map((g) => g.origin)).toEqual(["tool", "user", "workspace"])
		expect(groups[0].layers.map((l) => l.id)).toEqual(["t1", "t2"])
	})
})

describe("what a row says about itself", () => {
	it("keeps real warnings per row and treats Limited layer as a quiet note", () => {
		const limited = layer("x", { geojson: "" }, { tool: "extract_rivers", provenance_path: "/p.json" })
		const ind = rowIndicators(limited)
		expect(ind.warnings).toEqual([])
		expect(ind.note).toMatch(/^Limited layer\./)
	})

	it("never hides a missing provenance, a changed source, a preview or a simplified geometry", () => {
		const bad = layer(
			"y",
			{},
			{ tool: "delineate_watershed", source_status: "source_changed", display_mode: "preview", simplified: "true" },
		)
		const text = rowIndicators(bad).warnings.join(" | ")
		expect(text).toMatch(/Missing provenance/)
		expect(text).toMatch(/source file changed/)
		expect(text).toMatch(/preview/i)
		expect(text).toMatch(/simplified/i)
	})

	it("states a note once for a group only when every layer has the same one", () => {
		const note = (n?: string) => ({ warnings: [], note: n })
		expect(sharedNote([note("N"), note("N"), note("N")])).toBe("N")
		expect(sharedNote([note("N"), note("N"), note()])).toBeUndefined()
		expect(sharedNote([note("N")])).toBeUndefined()
	})
})

describe("duplicates", () => {
	const run = { tool: "delineate_watershed", _run_id: "run-7f3a.1" }
	it("are the same name, tool, run and source", () => {
		expect(duplicateKey(layer("a", { name: "watershed" }, run))).toBe(duplicateKey(layer("b", { name: "Watershed " }, run)))
		expect(duplicateKey(layer("a", { name: "watershed" }, run))).not.toBe(
			duplicateKey(layer("c", { name: "watershed" }, { ...run, _run_id: "run-9.1" })),
		)
	})

	it("never call hand-loaded layers with no run or path duplicates", () => {
		expect(duplicateKey(layer("a", { name: "sites" }, { source: "user" }))).toBeNull()
		expect(duplicateIds([layer("a", { name: "sites" }), layer("b", { name: "sites" })]).size).toBe(0)
	})

	it("keeps a visible copy, otherwise the first, and drops the rest", () => {
		const a = layer("a", { name: "w" }, run)
		const b = layer("b", { name: "w" }, run)
		const c = layer("c", { name: "w" }, run)
		expect(duplicatesToRemove([a, b, c], (id) => id === "b").map((l) => l.id)).toEqual(["a", "c"])
		expect(duplicatesToRemove([a, b, c], () => false).map((l) => l.id)).toEqual(["b", "c"])
		expect([...duplicateIds([a, b, c])].sort()).toEqual(["a", "b", "c"])
	})

	it("layers from one run that differ in geometry or time range are not duplicates", () => {
		const a = layer("a", { name: "w", geojson: '{"type":"A"}' }, run)
		const b = layer("b", { name: "w", geojson: '{"type":"B"}' }, run)
		const c = layer("c", { name: "w", geojson: '{"type":"A"}' }, run)
		const d = layer("d", { name: "ndvi", layerType: "gee_tile", geojson: "" }, { ...run, gee_start_date: "2020-01-01" })
		const e = layer("e", { name: "ndvi", layerType: "gee_tile", geojson: "" }, { ...run, gee_start_date: "2021-01-01" })
		expect(duplicateKey(a)).not.toBe(duplicateKey(b))
		expect(duplicateKey(a)).toBe(duplicateKey(c))
		expect(duplicateKey(d)).not.toBe(duplicateKey(e))
	})

	it("stacking: the last id of the draw order is on top, which is what MapView renders and the list shows first", () => {
		const [a, b, c] = [layer("a"), layer("b"), layer("c")]
		const draw = drawOrder([a, b, c], ["c", "a", "b"])
		expect(draw.map((l) => l.id)).toEqual(["c", "a", "b"]) // MapView hands exactly this to deck.gl: b is drawn last, on top
		expect(listOrder(draw).map((l) => l.id)).toEqual(["b", "a", "c"])
		expect(stackPosition(draw, "b")).toEqual({ position: 1, of: 3 })
		expect(stackPosition(draw, "c")).toEqual({ position: 3, of: 3 })
		// Layers missing from the persisted order are appended, so they draw on top.
		expect(drawOrder([a, b, c], ["c"]).map((l) => l.id)).toEqual(["c", "a", "b"])
		expect(stackPosition(draw, "zzz")).toBeNull()
	})
})
