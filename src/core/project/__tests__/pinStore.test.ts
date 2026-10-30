import { expect } from "chai"
import { describe, it } from "mocha"
import {
	bucketKey,
	checkSaveTarget,
	LEGACY_ANNOTATIONS_KEY,
	LEGACY_CLAIMED_BY_KEY,
	LEGACY_COLLECTIONS_KEY,
	loadPinsForProject,
	NO_FOLDER_KEY,
	type PinStateStore,
	QUARANTINE_KEY,
	quarantinePins,
	savePinsForProject,
} from "../pinStore"

function memento(initial: Record<string, unknown> = {}): PinStateStore & { data: Record<string, unknown> } {
	const data = { ...initial }
	return {
		data,
		get: <T>(key: string) => data[key] as T | undefined,
		update: async (key: string, value: unknown) => {
			if (value === undefined) {
				delete data[key]
			} else {
				data[key] = value
			}
		},
	}
}

const pin = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, type: "point", ...extra })
const ids = (list: unknown[]) => list.map((p) => (p as { id: string }).id)
const A = { key: "dir:aaa", kind: "dir" as const }
const B = { key: "dir:bbb", kind: "dir" as const }
const NONE = { key: NO_FOLDER_KEY, kind: "dir" as const }
const PRJ = { key: "prj_01ABC", kind: "prj" as const }

describe("pin store (X1-M2)", () => {
	it("keeps each project in its own Memento key: pins saved in project A are absent in project B", async () => {
		const store = memento()
		await savePinsForProject(store, A.key, [pin("a1")], [])
		await savePinsForProject(store, B.key, [pin("b1"), pin("b2")], [])
		expect(Object.keys(store.data).sort()).to.deep.equal([bucketKey(A.key), bucketKey(B.key)])
		expect(ids((await loadPinsForProject(store, A)).annotations)).to.deep.equal(["a1"])
		expect(ids((await loadPinsForProject(store, B)).annotations)).to.deep.equal(["b1", "b2"])
		expect((await loadPinsForProject(store, { key: "dir:ccc", kind: "dir" })).annotations).to.deep.equal([])
	})

	describe("the save goes to the key the map loaded", () => {
		it("writes when the loaded key is the open folder's key, or its dir: key after a prj_ flip", () => {
			expect(checkSaveTarget(A.key, { key: A })).to.equal("write")
			expect(checkSaveTarget(A.key, { key: PRJ, dirKey: A.key })).to.equal("write")
			expect(checkSaveTarget(PRJ.key, { key: PRJ, dirKey: A.key })).to.equal("write")
		})

		it("asks for a reload, and never writes, after a folder reorder, add or remove", async () => {
			// The map loaded project A. The first folder is now B (folders reordered mid-session).
			expect(checkSaveTarget(A.key, { key: B })).to.equal("reload")
			expect(checkSaveTarget(A.key, { key: NONE })).to.equal("reload") // last folder removed
			expect(checkSaveTarget(undefined, { key: A })).to.equal("reload")
			expect(checkSaveTarget("", { key: A })).to.equal("reload")
			// And the gate is what stops the write: B's pins are untouched.
			const store = memento()
			await savePinsForProject(store, B.key, [pin("b1")], [])
			if (checkSaveTarget(A.key, { key: B }) === "write") {
				await savePinsForProject(store, A.key, [pin("a1")], [])
			}
			expect(ids((await loadPinsForProject(store, B)).annotations)).to.deep.equal(["b1"])
			expect(store.data[bucketKey(A.key)]).to.equal(undefined)
		})

		it("a save into the dir: bucket after the flip stays in the dir: bucket until the next load migrates it", async () => {
			const store = memento()
			await savePinsForProject(store, A.key, [pin("a1")], [])
			await savePinsForProject(store, A.key, [pin("a1"), pin("a2")], []) // saved mid-session, after the flip
			expect(store.data[bucketKey(PRJ.key)]).to.equal(undefined)
			const loaded = await loadPinsForProject(store, PRJ, { dirKey: A.key })
			expect(ids(loaded.annotations)).to.deep.equal(["a1", "a2"])
			expect(store.data[bucketKey(A.key)]).to.equal(undefined)
		})
	})

	describe("dir: -> prj_ migration", () => {
		it("moves the dir: bucket to the prj_ bucket, and only that folder's", async () => {
			const store = memento()
			await savePinsForProject(store, A.key, [pin("a1")], [{ id: "c1" }])
			await savePinsForProject(store, B.key, [pin("b1")], [])
			const loaded = await loadPinsForProject(store, PRJ, { dirKey: A.key })
			expect(ids(loaded.annotations)).to.deep.equal(["a1"])
			expect(loaded.collections).to.deep.equal([{ id: "c1" }])
			expect(Object.keys(store.data).sort()).to.deep.equal([bucketKey(B.key), bucketKey(PRJ.key)])
			expect(ids((await loadPinsForProject(store, PRJ, { dirKey: A.key })).annotations)).to.deep.equal(["a1"])
		})

		it("does not duplicate a pin saved under both keys, and keeps both buckets' collections", async () => {
			const store = memento()
			await savePinsForProject(store, PRJ.key, [pin("same"), pin("p1")], [{ id: "cp" }])
			await savePinsForProject(store, A.key, [pin("same"), pin("a1")], [{ id: "cd" }, { id: "cp" }])
			const loaded = await loadPinsForProject(store, PRJ, { dirKey: A.key })
			expect(ids(loaded.annotations)).to.deep.equal(["same", "p1", "a1"])
			expect(ids(loaded.collections)).to.deep.equal(["cp", "cd"])
		})

		it("does not bring back a pin that was deleted in either bucket", async () => {
			const store = memento()
			// prj_ had x and y, then x was deleted there; the dir: bucket (older, never saw the delete) still has x.
			await savePinsForProject(store, PRJ.key, [pin("x"), pin("y")], [])
			await savePinsForProject(store, A.key, [pin("x"), pin("z")], [])
			await savePinsForProject(store, PRJ.key, [pin("y")], [])
			// ...and z was deleted in the dir: bucket while prj_ (stale) still has it.
			await savePinsForProject(store, PRJ.key, [pin("y"), pin("z")], [])
			await savePinsForProject(store, A.key, [pin("x")], [])
			const loaded = await loadPinsForProject(store, PRJ, { dirKey: A.key })
			expect(ids(loaded.annotations).sort()).to.deep.equal(["y"])
		})

		it("a pin deleted and then restored by Undo is not tombstoned", async () => {
			const store = memento()
			await savePinsForProject(store, PRJ.key, [pin("x")], [])
			await savePinsForProject(store, PRJ.key, [], [])
			await savePinsForProject(store, PRJ.key, [pin("x")], [])
			await savePinsForProject(store, A.key, [pin("x")], [])
			expect(ids((await loadPinsForProject(store, PRJ, { dirKey: A.key })).annotations)).to.deep.equal(["x"])
		})
	})

	describe("the pre-project list", () => {
		const legacy = [pin("g1"), pin("g2")]
		const seeded = () => memento({ [LEGACY_ANNOTATIONS_KEY]: legacy, [LEGACY_COLLECTIONS_KEY]: [{ id: "col_1" }] })

		it("goes to the first project only, marked imported, and the legacy key stays", async () => {
			const store = seeded()
			const first = await loadPinsForProject(store, A)
			expect(first.importedCount).to.equal(2)
			expect(first.annotations).to.deep.equal([pin("g1", { imported: true }), pin("g2", { imported: true })])
			expect(first.collections).to.deep.equal([{ id: "col_1" }])
			expect(store.data[LEGACY_CLAIMED_BY_KEY]).to.equal(A.key)
			expect(store.data[LEGACY_ANNOTATIONS_KEY]).to.deep.equal(legacy)
			const other = await loadPinsForProject(store, B)
			expect(other.importedCount).to.equal(0)
			expect(other.annotations).to.deep.equal([])
			const again = await loadPinsForProject(store, A)
			expect(again.importedCount).to.equal(0)
			expect(again.annotations).to.have.length(2)
		})

		it('never claims for "no folder": the list waits for the first real project', async () => {
			const store = seeded()
			const none = await loadPinsForProject(store, NONE)
			expect(none.importedCount).to.equal(0)
			expect(none.annotations).to.deep.equal([])
			expect(store.data[LEGACY_CLAIMED_BY_KEY]).to.equal(undefined)
			const real = await loadPinsForProject(store, A)
			expect(real.importedCount).to.equal(2)
		})

		it('treats an earlier claim by "no folder" as unclaimed, so existing users get their pins back', async () => {
			const store = seeded()
			store.data[LEGACY_CLAIMED_BY_KEY] = NO_FOLDER_KEY
			const real = await loadPinsForProject(store, A)
			expect(real.importedCount).to.equal(2)
			expect(store.data[LEGACY_CLAIMED_BY_KEY]).to.equal(A.key)
		})

		it("lets only one of two windows import it (simulated claim race)", async () => {
			// Both windows see "unclaimed" and both write their claim before either reads it back; the last write wins.
			// The store defers every write by a tick, which interleaves the two loads exactly like that.
			const base = seeded()
			const slow: PinStateStore = {
				get: (key) => base.get(key),
				update: async (key, value) => {
					await Promise.resolve()
					await base.update(key, value)
				},
			}
			const [a, b] = await Promise.all([loadPinsForProject(slow, A), loadPinsForProject(slow, B)])
			expect(a.importedCount + b.importedCount).to.equal(2) // exactly one window imported the two pins
			expect([a.importedCount, b.importedCount].sort()).to.deep.equal([0, 2])
			expect(base.data[LEGACY_CLAIMED_BY_KEY]).to.equal(B.key)
			expect(base.data[bucketKey(A.key)]).to.equal(undefined)
			expect(ids((base.data[bucketKey(B.key)] as { annotations: unknown[] }).annotations)).to.deep.equal(["g1", "g2"])
		})

		it("does not bring pins back after the user cleared the imported ones", async () => {
			const store = seeded()
			await loadPinsForProject(store, A)
			await savePinsForProject(store, A.key, [], [])
			const loaded = await loadPinsForProject(store, A)
			expect(loaded.annotations).to.deep.equal([])
			expect(loaded.importedCount).to.equal(0)
		})

		it("falls back to the webview's own copy when the host never saved one", async () => {
			const loaded = await loadPinsForProject(memento(), A, { legacyLocal: [pin("l1"), "junk", null] })
			expect(loaded.importedCount).to.equal(1)
			expect(loaded.annotations).to.deep.equal([pin("l1", { imported: true })])
		})
	})

	describe("quarantine", () => {
		it("keeps unreadable entries verbatim, once, with the project and time", async () => {
			const store = memento()
			const bad = { id: "bad", geometry: { type: "Point", coordinates: ["x", 1] } }
			expect(await quarantinePins(store, A.key, [bad])).to.equal(1)
			expect(await quarantinePins(store, A.key, [bad])).to.equal(0)
			const kept = store.data[QUARANTINE_KEY] as { projectKey: string; entry: unknown; quarantinedAt: string }[]
			expect(kept).to.have.length(1)
			expect(kept[0].entry).to.deep.equal(bad)
			expect(kept[0].projectKey).to.equal(A.key)
			expect(kept[0].quarantinedAt).to.be.a("string")
			expect(await quarantinePins(store, A.key, [])).to.equal(0)
		})
	})
})
