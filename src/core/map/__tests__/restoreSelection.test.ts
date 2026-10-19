import { expect } from "chai"
import { describe, it } from "mocha"
import type { MapLayerCatalog, MapLayerCatalogEntry } from "../mapLayerCatalog"
import { MAX_RESTORED_LAYERS, selectCatalogEntriesToRestore } from "../restoreSelection"

const entry = (id: string): MapLayerCatalogEntry =>
	({ id, name: id, layer_type: "polygon", visible: true, metadata_snapshot: {} }) as unknown as MapLayerCatalogEntry
const catalog = (ids: string[], extra: Partial<MapLayerCatalog> = {}): MapLayerCatalog => ({
	updated_at_ms: 0,
	layer_order: ids,
	layers: ids.map(entry),
	...extra,
})

describe("selectCatalogEntriesToRestore", () => {
	it("restores everything under the cap, in display order", () => {
		const sel = selectCatalogEntriesToRestore(catalog(["a", "b", "c"]), "/ws")
		expect(sel.entries.map((e) => e.id)).to.deep.equal(["a", "b", "c"])
		expect(sel).to.include({ total: 3, outOfScope: 0, capped: 0 })
	})

	it("caps an unscoped (legacy) catalog to the most recent entries and reports the total honestly", () => {
		const ids = Array.from({ length: MAX_RESTORED_LAYERS + 60 }, (_, i) => `l${i}`)
		const sel = selectCatalogEntriesToRestore(catalog(ids), "/ws")
		expect(sel.entries).to.have.length(MAX_RESTORED_LAYERS)
		expect(sel.entries[sel.entries.length - 1].id).to.equal(ids[ids.length - 1])
		expect(sel.total).to.equal(ids.length)
		expect(sel.capped).to.equal(60)
	})

	it("restores nothing from a catalog written for another workspace", () => {
		const sel = selectCatalogEntriesToRestore(catalog(["a", "b"], { workspace_root: "/other" }), "/ws")
		expect(sel.entries).to.have.length(0)
		expect(sel.outOfScope).to.equal(2)
	})

	it("restores a catalog scoped to the current workspace", () => {
		const sel = selectCatalogEntriesToRestore(catalog(["a"], { workspace_root: "/ws" }), "/ws")
		expect(sel.entries.map((e) => e.id)).to.deep.equal(["a"])
	})

	it("appends entries missing from layer_order", () => {
		const c = catalog(["a", "b"])
		c.layer_order = ["b"]
		expect(selectCatalogEntriesToRestore(c, "/ws").entries.map((e) => e.id)).to.deep.equal(["b", "a"])
	})
})
