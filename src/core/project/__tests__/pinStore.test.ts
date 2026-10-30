import { expect } from "chai"
import { describe, it } from "mocha"
import {
	LEGACY_ANNOTATIONS_KEY,
	LEGACY_CLAIMED_BY_KEY,
	LEGACY_COLLECTIONS_KEY,
	loadPinsForProject,
	PINS_BY_PROJECT_KEY,
	type PinStateStore,
	savePinsForProject,
} from "../pinStore"

function memento(initial: Record<string, unknown> = {}): PinStateStore & { data: Record<string, unknown> } {
	const data = { ...initial }
	return {
		data,
		get: <T>(key: string) => data[key] as T | undefined,
		update: async (key: string, value: unknown) => {
			data[key] = value
		},
	}
}

const pin = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, type: "point", ...extra })
const A = { key: "dir:aaa", kind: "dir" as const }
const B = { key: "dir:bbb", kind: "dir" as const }

describe("pin store (X1-M2)", () => {
	it("keeps each project's pins apart: pins saved in project A are absent in project B", async () => {
		const store = memento()
		await savePinsForProject(store, A, [pin("a1")], [])
		await savePinsForProject(store, B, [pin("b1"), pin("b2")], [])
		expect((await loadPinsForProject(store, A)).annotations).to.deep.equal([pin("a1")])
		expect((await loadPinsForProject(store, B)).annotations).to.have.length(2)
		expect((await loadPinsForProject(store, { key: "dir:ccc", kind: "dir" })).annotations).to.deep.equal([])
	})

	it("moves a dir: bucket to the prj_ bucket once the project has an id, and only that project's", async () => {
		const store = memento()
		await savePinsForProject(store, A, [pin("a1")], [])
		await savePinsForProject(store, B, [pin("b1")], [])
		const prj = { key: "prj_01ABC", kind: "prj" as const }
		const loaded = await loadPinsForProject(store, prj, { dirKey: A.key })
		expect(loaded.annotations).to.deep.equal([pin("a1")])
		const buckets = store.data[PINS_BY_PROJECT_KEY] as Record<string, unknown>
		expect(Object.keys(buckets).sort()).to.deep.equal(["dir:bbb", "prj_01ABC"])
		// A second call is a no-op.
		expect((await loadPinsForProject(store, prj, { dirKey: A.key })).annotations).to.deep.equal([pin("a1")])
	})

	it("merges a dir: bucket into an existing prj_ bucket instead of overwriting it", async () => {
		const store = memento()
		const prj = { key: "prj_01ABC", kind: "prj" as const }
		await savePinsForProject(store, prj, [pin("p1")], [])
		await savePinsForProject(store, A, [pin("a1")], [])
		const loaded = await loadPinsForProject(store, prj, { dirKey: A.key })
		expect(loaded.annotations.map((p) => (p as { id: string }).id)).to.deep.equal(["p1", "a1"])
	})

	it("does not duplicate a pin that was saved under both keys", async () => {
		const store = memento()
		const prj = { key: "prj_01ABC", kind: "prj" as const }
		await savePinsForProject(store, prj, [pin("same"), pin("p1")], [])
		await savePinsForProject(store, A, [pin("same"), pin("a1")], [])
		const loaded = await loadPinsForProject(store, prj, { dirKey: A.key })
		expect(loaded.annotations.map((p) => (p as { id: string }).id)).to.deep.equal(["same", "p1", "a1"])
	})

	it("hands the pre-project global list to the first project only, marked imported, and keeps the legacy key", async () => {
		const legacy = [pin("g1"), pin("g2")]
		const store = memento({
			[LEGACY_ANNOTATIONS_KEY]: legacy,
			[LEGACY_COLLECTIONS_KEY]: [{ id: "col_1" }],
		})
		const first = await loadPinsForProject(store, A)
		expect(first.importedCount).to.equal(2)
		expect(first.annotations).to.deep.equal([pin("g1", { imported: true }), pin("g2", { imported: true })])
		expect(first.collections).to.deep.equal([{ id: "col_1" }])
		expect(store.data[LEGACY_CLAIMED_BY_KEY]).to.equal(A.key)
		expect(store.data[LEGACY_ANNOTATIONS_KEY]).to.deep.equal(legacy)

		const other = await loadPinsForProject(store, B)
		expect(other.importedCount).to.equal(0)
		expect(other.annotations).to.deep.equal([])
		// The first project loads the same pins again, without re-importing.
		const again = await loadPinsForProject(store, A)
		expect(again.importedCount).to.equal(0)
		expect(again.annotations).to.have.length(2)
	})

	it("does not bring pins back after the user cleared the imported ones", async () => {
		const store = memento({ [LEGACY_ANNOTATIONS_KEY]: [pin("g1")] })
		await loadPinsForProject(store, A)
		await savePinsForProject(store, A, [], [])
		const loaded = await loadPinsForProject(store, A)
		expect(loaded.annotations).to.deep.equal([])
		expect(loaded.importedCount).to.equal(0)
	})

	it("falls back to the webview's own copy of the old list when the host never saved one", async () => {
		const store = memento()
		const loaded = await loadPinsForProject(store, A, { legacyLocal: [pin("l1"), "junk", null] })
		expect(loaded.importedCount).to.equal(1)
		expect(loaded.annotations).to.deep.equal([pin("l1", { imported: true })])
	})
})
