import type { MapLayer, RemovedFileEntry, WorkspaceGeoFile } from "@shared/proto/cline/map"
import { describe, expect, it } from "vitest"
import { buildRows, filterMatches, folderKeysOf, layerOfFile, layersByFile, matchesFilter, notOnMap } from "../projectFilesModel"

const f = (relativePath: string, folder = "/ws", folderName = "ws"): WorkspaceGeoFile =>
	({ relativePath, workspaceFolder: folder, folderName, name: relativePath.split("/").pop(), extension: ".geojson", sizeBytes: 10, mtimeMs: 0 }) as WorkspaceGeoFile
const rows = (files: WorkspaceGeoFile[], extra: Partial<Parameters<typeof buildRows>[0]> = {}) =>
	buildRows({ files, removed: [], filter: "", open: new Set(), removedOpen: false, ...extra })

describe("project files rows", () => {
	it("up to 20 files the folders start open and the list reads flat under them", () => {
		const r = rows([f("a/x.geojson"), f("a/y.geojson"), f("top.geojson")])
		expect(r.map((x) => x.kind)).toEqual(["folder", "file", "file", "file"])
	})

	it("above 20 files every folder starts collapsed, and flipping one opens only it", () => {
		const files = Array.from({ length: 25 }, (_, i) => f(`d${i % 3}/f${i}.geojson`))
		const closed = rows(files)
		expect(closed.every((x) => x.kind === "folder" && !x.open)).toBe(true)
		const key = (closed[0] as { key: string }).key
		const flipped = rows(files, { open: new Set([key]) })
		expect(flipped.filter((x) => x.kind === "file").length).toBeGreaterThan(0)
		expect(flipped.filter((x) => x.kind === "folder" && x.open)).toHaveLength(1)
	})

	it("a filter flattens to the matching files", () => {
		const r = rows([f("data/huc8.geojson"), f("data/gauges.geojson")], { filter: "HUC" })
		expect(r).toHaveLength(1)
		expect(r[0]).toMatchObject({ kind: "file" })
	})

	it("a file on the map is not listed: each file is one row, on the map or under Not on the map", () => {
		const files = [f("a.geojson"), f("b.geojson"), f("c.geojson")]
		const onMap = { id: "L1", metadata: { source_path: "/ws/b.geojson" } } as unknown as MapLayer
		const left = notOnMap(files, layersByFile([onMap]))
		expect(left.map((x) => x.relativePath)).toEqual(["a.geojson", "c.geojson"])
		expect(notOnMap(files, layersByFile([]))).toHaveLength(3)
		// After Unload the layer is gone and the file is listed again.
		expect(notOnMap(files, layersByFile([])).map((x) => x.relativePath)).toContain("b.geojson")
	})

	it("multi-root: one root row per open folder, and the same relative path in two folders stays two rows", () => {
		const r = rows([f("data/a.geojson", "/one", "one"), f("data/a.geojson", "/two", "two")])
		expect(r.filter((x) => x.kind === "folder" && x.depth === 0).map((x) => (x as { name: string }).name)).toEqual(["one", "two"])
		expect(r.filter((x) => x.kind === "file")).toHaveLength(2)
	})

	it("removed entries sit last under Removed from list (N), listed only when it is open", () => {
		const removed = [{ relativePath: "old.geojson", workspaceFolder: "/ws", folderName: "ws", name: "old.geojson", kind: "file", removedAt: 1 }] as RemovedFileEntry[]
		expect(rows([f("a.geojson")], { removed }).at(-1)).toMatchObject({ kind: "removed-head", count: 1, open: false })
		expect(rows([f("a.geojson")], { removed, removedOpen: true }).at(-1)).toMatchObject({ kind: "removed" })
	})

	it("Remove N matches counts the matches, and none for an empty filter", () => {
		const files = [f("huc_1.geojson"), f("huc_2.geojson"), f("other.geojson")]
		expect(filterMatches(files, "huc").map((x) => x.relativePath)).toEqual(["huc_1.geojson", "huc_2.geojson"])
		expect(filterMatches(files, "")).toEqual([])
		expect(matchesFilter(files[0], "  ")).toBe(true)
	})

	it("names the folders above a file, so a row that just moved can be revealed", () => {
		expect(folderKeysOf(f("a/b/x.geojson"), false)).toEqual(["dir\u0000/ws\u0000a", "dir\u0000/ws\u0000a/b"])
		expect(folderKeysOf(f("x.geojson"), true)).toEqual(["root\u0000/ws"])
	})

	it("finds the layer of a file by resolved path, and a layer saved with a relative path only", () => {
		const file = f("a.geojson")
		const abs = { id: "1", metadata: { source_path: "/ws/a.geojson" } } as unknown as MapLayer
		const rel = { id: "2", metadata: { path: "a.geojson" } } as unknown as MapLayer
		expect(layerOfFile(file, layersByFile([abs]))?.id).toBe("1")
		expect(layerOfFile(file, layersByFile([rel]))?.id).toBe("2")
		expect(layerOfFile(f("b.geojson"), layersByFile([abs, rel]))).toBeUndefined()
	})

	it("trusts the host's real-path match: a symlinked folder or /var vs /private/var still counts as loaded", () => {
		const file = { ...f("a.geojson"), loadedLayerId: "L9" } as WorkspaceGeoFile
		const layer = { id: "L9", metadata: { source_path: "/private/ws-real/a.geojson" } } as unknown as MapLayer
		expect(layerOfFile(file, layersByFile([layer]))?.id).toBe("L9")
		expect(layerOfFile({ ...file, loadedLayerId: "" } as WorkspaceGeoFile, layersByFile([layer]))).toBeUndefined()
	})

	it("a legacy layer that recorded only a relative path matches a file in one open folder, never with several", () => {
		const legacy = { id: "9", metadata: { path: "a.geojson" } } as unknown as MapLayer
		expect(layerOfFile(f("a.geojson"), layersByFile([legacy], true))?.id).toBe("9")
		expect(layerOfFile(f("a.geojson"), layersByFile([legacy], false))).toBeUndefined()
		expect(notOnMap([f("a.geojson", "/one", "one"), f("a.geojson", "/two", "two")], layersByFile([legacy], false))).toHaveLength(2)
	})

	it("two layers from one file keep it off the list until both are gone", () => {
		const a = { id: "1", metadata: { source_path: "/ws/a.geojson" } } as unknown as MapLayer
		const b = { id: "2", metadata: { source_path: "/ws/a.geojson" } } as unknown as MapLayer
		expect(notOnMap([f("a.geojson")], layersByFile([a, b]))).toHaveLength(0)
		expect(notOnMap([f("a.geojson")], layersByFile([b]))).toHaveLength(0)
		expect(notOnMap([f("a.geojson")], layersByFile([]))).toHaveLength(1)
	})
})
