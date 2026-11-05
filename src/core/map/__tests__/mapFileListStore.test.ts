import { expect } from "chai"
import { describe, it } from "mocha"
import {
	addRemoved,
	type FileListStateStore,
	indexRemoved,
	normalizeRelative,
	readRemoved,
	REMOVED_KEY_PREFIX,
	removedKey,
	restoreRemoved,
} from "../mapFileListStore"

function memento(initial: Record<string, unknown> = {}): FileListStateStore & { data: Record<string, unknown> } {
	const data = { ...initial }
	return {
		data,
		get: <T>(key: string) => data[key] as T | undefined,
		update: async (key: string, value: unknown) => {
			if (value === undefined) delete data[key]
			else data[key] = value
		},
	}
}
const PRJ = { key: "prj_01ABC", kind: "prj" as const }
const DIR = { key: "dir:aaa", kind: "dir" as const }
const H1 = "1111111111111111"
const H2 = "2222222222222222"

describe("removed-from-list store", () => {
	it("stores a folder hash and a relative path, never an absolute path", async () => {
		const store = memento()
		await addRemoved(store, DIR.key, [{ folderHash: H1, relativePath: "data/a.geojson" }])
		const raw = JSON.stringify(store.data)
		expect(raw).to.contain("data/a.geojson").and.to.contain(H1)
		expect(raw).to.not.match(/\/Users\/|\/home\/|[A-Za-z]:\\\\/)
		const [entry] = store.data[removedKey(DIR.key)] as Record<string, unknown>[]
		expect(Object.keys(entry).sort()).to.deep.equal(["folderHash", "kind", "relativePath", "removedAt"])
	})

	it("refuses an entry that is absolute or climbs out of its folder", async () => {
		const store = memento()
		const added = await addRemoved(store, DIR.key, [
			{ folderHash: H1, relativePath: "/etc/hosts" },
			{ folderHash: H1, relativePath: "../x.geojson" },
			{ folderHash: H1, relativePath: "C:\\x.geojson" },
			{ folderHash: "", relativePath: "ok.geojson" },
		])
		expect(added).to.equal(0)
		expect(store.data[removedKey(DIR.key)]).to.equal(undefined)
	})

	it("survives a reload (a new read of the same store) and a repeat removal adds nothing", async () => {
		const store = memento()
		expect(await addRemoved(store, DIR.key, [{ folderHash: H1, relativePath: "a/b.geojson" }])).to.equal(1)
		expect(await addRemoved(store, DIR.key, [{ folderHash: H1, relativePath: "a\\b.geojson" }])).to.equal(0)
		const reread = await readRemoved(store, DIR)
		expect(reread.map((e) => e.relativePath)).to.deep.equal(["a/b.geojson"])
	})

	it("restores one entry, or all, and leaves the others", async () => {
		const store = memento()
		await addRemoved(store, DIR.key, [
			{ folderHash: H1, relativePath: "a.geojson" },
			{ folderHash: H1, relativePath: "b.geojson" },
		])
		expect(await restoreRemoved(store, DIR.key, [{ folderHash: H1, relativePath: "a.geojson" }])).to.equal(1)
		expect((await readRemoved(store, DIR)).map((e) => e.relativePath)).to.deep.equal(["b.geojson"])
		expect(await restoreRemoved(store, DIR.key, "all")).to.equal(1)
		expect(await readRemoved(store, DIR)).to.deep.equal([])
	})

	it("keeps each project's list under its own key", async () => {
		const store = memento()
		await addRemoved(store, "dir:aaa", [{ folderHash: H1, relativePath: "a.geojson" }])
		await addRemoved(store, "dir:bbb", [{ folderHash: H1, relativePath: "b.geojson" }])
		expect(Object.keys(store.data).sort()).to.deep.equal([`${REMOVED_KEY_PREFIX}dir:aaa`, `${REMOVED_KEY_PREFIX}dir:bbb`])
		expect((await readRemoved(store, { key: "dir:aaa", kind: "dir" })).map((e) => e.relativePath)).to.deep.equal(["a.geojson"])
	})

	it("moves a list saved under the folder's dir: key to the project's prj_ key once it has one", async () => {
		const store = memento()
		await addRemoved(store, DIR.key, [{ folderHash: H1, relativePath: "old.geojson" }])
		await addRemoved(store, PRJ.key, [{ folderHash: H1, relativePath: "new.geojson" }])
		const merged = await readRemoved(store, PRJ, { dirKey: DIR.key })
		expect(merged.map((e) => e.relativePath).sort()).to.deep.equal(["new.geojson", "old.geojson"])
		expect(store.data[removedKey(DIR.key)]).to.equal(undefined)
	})

	it("hides a file by path and by folder, and tells folders in a multi-root window apart by hash", async () => {
		const store = memento()
		await addRemoved(store, DIR.key, [
			{ folderHash: H1, relativePath: "one.geojson" },
			{ folderHash: H1, relativePath: "old", kind: "folder" },
		])
		const index = indexRemoved(await readRemoved(store, DIR))
		expect(index.has(H1, "one.geojson")).to.equal(true)
		expect(index.has(H2, "one.geojson")).to.equal(false)
		expect(index.has(H1, "old/deep/x.geojson")).to.equal(true)
		expect(index.has(H1, "older/x.geojson")).to.equal(false)
	})

	it("normalises separators and a leading ./", () => {
		expect(normalizeRelative(".\\a\\b.geojson")).to.equal("a/b.geojson")
		expect(normalizeRelative("a/b/")).to.equal("a/b")
	})
})
