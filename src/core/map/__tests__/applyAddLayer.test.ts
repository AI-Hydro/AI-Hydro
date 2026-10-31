import { MapLayer } from "@shared/proto/cline/map"
import { expect } from "chai"
import { describe, it } from "mocha"
import { applyAddLayer, dropAliasesFor, type LayerStoreState, resolveAlias } from "../applyAddLayer"

const GJ = '{"type":"FeatureCollection","features":[{"a":1}]}'
const GJ2 = GJ.replace("1", "2")
const layer = (id: string, metadata: Record<string, string> = {}, geojson = GJ, over: Partial<MapLayer> = {}) =>
	MapLayer.create({ id, name: id, layerType: "polygon", geojson, visible: true, metadata, ...over })
const store = (...layers: MapLayer[]): LayerStoreState => ({
	layers: new Map(layers.map((l) => [l.id, l])),
	order: layers.map((l) => l.id),
	aliases: new Map(),
})
const P = { source_path: "/w/v/a.geojson", source_size_bytes: "52" }

describe("applyAddLayer: one file is one layer", () => {
	it("Reload source: same path, same size, different content, no run, updates the layer in place", () => {
		const style = { fillColor: "#ff0000" } as any
		const onMap = layer(
			"workspace_v_a",
			{
				source: "workspace",
				path: "v/a.geojson",
				workspace_folder: "/w",
				source_size_bytes: "52",
				source_status: "source_changed",
			},
			GJ,
			{ visible: false, style },
		)
		const s = store(layer("other"), onMap, layer("last"))
		const out = applyAddLayer(s, layer("user-a", { source: "user", ...P }, GJ2))
		expect(out.kind).to.equal("updated")
		const kept = s.layers.get("workspace_v_a")!
		expect(kept.geojson).to.equal(GJ2)
		expect(kept.visible).to.equal(false) // a hidden layer does not reappear
		expect(kept.style).to.deep.equal(onMap.style)
		expect(kept.metadata.source_status).to.equal("current")
		expect(s.order).to.deep.equal(["other", "workspace_v_a", "last"])
		expect(s.layers.has("user-a")).to.equal(false)
		expect(s.aliases.get("user-a")).to.equal("workspace_v_a")
	})

	it("the same file again with the same content is merged and the existing layer is selected, hidden state kept", () => {
		const s = store(layer("e", { source: "user", ...P }, GJ, { visible: false }))
		const out = applyAddLayer(
			s,
			layer(
				"n",
				{
					source: "workspace",
					path: "v/a.geojson",
					workspace_folder: "/w",
					_run_id: "run-3",
					tool: "delineate_watershed",
				},
				GJ,
			),
		)
		expect(out.kind).to.equal("merged")
		expect((out as any).note).to.match(/Already on the map/)
		const kept = s.layers.get("e")!
		expect(kept.visible).to.equal(false)
		expect(kept.metadata._run_id).to.equal("run-3")
		expect(s.layers.size).to.equal(1)
	})

	it("case 1: a layer with run R1, the file overwritten, a plain re-add: new content, run link removed and named", () => {
		const s = store(layer("e", { _run_id: "R1", tool: "delineate_watershed", provenance_path: "/p.json", ...P }, GJ))
		const out = applyAddLayer(s, layer("n", { source: "user", ...P }, GJ2))
		expect(out.kind).to.equal("updated")
		expect((out as any).priorRun).to.equal("R1")
		expect((out as any).note).to.match(/changed since run R1.*run link was removed/)
		const kept = s.layers.get("e")!
		expect(kept.geojson).to.equal(GJ2)
		expect(kept.metadata._run_id).to.equal(undefined)
		expect(kept.metadata._prior_run_id).to.equal("R1")
		expect((out as any).note).to.not.match(/Already on the map/)
	})

	it("case 2: an agent re-push with the same run and path and new content updates the layer, keeping the run", () => {
		const s = store(layer("e", { _run_id: "R1", tool: "delineate_watershed", ...P }, GJ))
		const out = applyAddLayer(s, layer("n", { _run_id: "R1", tool: "delineate_watershed", ...P }, GJ2))
		expect(out.kind).to.equal("updated")
		expect(s.layers.get("e")!.geojson).to.equal(GJ2)
		expect(s.layers.get("e")!.metadata._run_id).to.equal("R1")
		expect((out as any).priorRun).to.equal(undefined)
	})

	it("case 3: two different tools with identical content and no path stay two layers", () => {
		const s = store(layer("a", { tool: "delineate_watershed" }, GJ))
		const out = applyAddLayer(s, layer("b", { tool: "extract_rivers" }, GJ))
		expect(out.kind).to.equal("added")
		expect(s.layers.size).to.equal(2)
	})

	it("two files with the same name and different content are two layers; a copy at another path is its own file", () => {
		const s = store(layer("a", { source_path: "/w/one/basin.geojson" }, GJ))
		expect(applyAddLayer(s, layer("b", { source_path: "/w/two/basin.geojson" }, GJ2)).kind).to.equal("added")
		expect(applyAddLayer(s, layer("c", { source_path: "/w/three/basin.geojson" }, GJ)).kind).to.equal("added")
		expect(s.layers.size).to.equal(3)
	})

	it("Undo: remove A, add the same file as B, Undo adds A back as its own layer (replaceExisting)", () => {
		const a = layer("A", { source: "user", ...P }, GJ)
		const s = store(a)
		s.layers.delete("A")
		s.order.splice(0)
		expect(applyAddLayer(s, layer("B", { source: "user", ...P }, GJ)).kind).to.equal("added")
		const undo = applyAddLayer(s, a, { replaceExisting: true })
		expect(undo.kind).to.equal("added")
		expect([...s.layers.keys()].sort()).to.deep.equal(["A", "B"])
		// Without the flag the same restore would have been folded into B.
		const s2 = store(layer("B", { source: "user", ...P }, GJ))
		expect(applyAddLayer(s2, a).kind).to.equal("merged")
	})

	it("a same-id add is an overwrite, not a duplicate", () => {
		const s = store(layer("a", P, GJ))
		expect(applyAddLayer(s, layer("a", P, GJ2)).kind).to.equal("added")
		expect(s.layers.get("a")!.geojson).to.equal(GJ2)
	})

	it("restoring an id that was merged away makes it a layer again", () => {
		const s = store(layer("e", P, GJ))
		applyAddLayer(s, layer("n", P, GJ))
		expect(s.aliases.get("n")).to.equal("e")
		applyAddLayer(s, layer("n", P, GJ), { replaceExisting: true })
		expect(s.aliases.has("n")).to.equal(false)
	})

	it("an id that was merged away resolves to the survivor, and stops resolving once the survivor is removed", () => {
		const s = store(layer("e", P, GJ))
		applyAddLayer(s, layer("n", P, GJ))
		expect(resolveAlias(s.aliases, "n")).to.equal("e")
		expect(resolveAlias(s.aliases, "other")).to.equal("other")
		dropAliasesFor(s.aliases, "e")
		expect(resolveAlias(s.aliases, "n")).to.equal("n")
	})

	it("a restored (empty) layer for a file already on the map neither updates nor empties it", () => {
		const s = store(layer("e", { ...P, units: "mm" }, GJ))
		const out = applyAddLayer(s, layer("n", { source_path: "/w/v/a.geojson", source_size_bytes: "99", units: "" }, ""))
		expect(out.kind).to.equal("merged")
		expect(s.layers.get("e")!.geojson).to.equal(GJ)
		expect(s.layers.get("e")!.metadata.units).to.equal("mm")
	})
})
