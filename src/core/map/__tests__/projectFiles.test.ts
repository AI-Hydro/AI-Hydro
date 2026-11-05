import type { ScanStats, WorkspaceGeoJsonFile } from "@core/workspace/FileScanner"
import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { type FileListStateStore, folderHashOf, REMOVED_KEY_PREFIX } from "../mapFileListStore"
import { changeFileList, listProjectFiles, type ProjectFilesHost } from "../projectFiles"
import { peekUnloaded, saveUnloaded } from "../unloadedLayerSidecar"

function memento(): FileListStateStore & { data: Record<string, unknown> } {
	const data: Record<string, unknown> = {}
	return {
		data,
		get: <T>(key: string) => data[key] as T | undefined,
		update: async (key: string, value: unknown) => {
			if (value === undefined) delete data[key]
			else data[key] = value
		},
	}
}

let root: string
let folders: { path: string; name: string }[]
let diskFiles: WorkspaceGeoJsonFile[]
let store: ReturnType<typeof memento>

const STATS: ScanStats = {
	foldersSkipped: 2,
	skippedNames: [".git", "node_modules"],
	symlinksFound: 1,
	symlinksSkipped: 1,
	truncated: false,
	folderCount: 1,
}
const host = (): ProjectFilesHost => ({
	files: () => diskFiles,
	stats: () => ({ ...STATS, folderCount: folders.length }),
	folders: () => folders,
	scope: async () => ({ store, key: { key: "dir:test", kind: "dir" } }),
})
const fileAt = (folder: { path: string; name: string }, rel: string, size = 10): WorkspaceGeoJsonFile =>
	({
		uri: { fsPath: path.join(folder.path, rel), toString: () => `file://${path.join(folder.path, rel)}` },
		workspaceFolder: folder.path,
		workspaceFolderName: folder.name,
		relativePath: rel,
		name: path.basename(rel),
		extension: path.extname(rel),
		lastModified: 1000,
		sizeBytes: size,
		requiresConversion: false,
	}) as unknown as WorkspaceGeoJsonFile

beforeEach(async () => {
	root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "aih-pf-")))
	folders = [{ path: path.join(root, "proj"), name: "proj" }]
	await fs.mkdir(path.join(root, "proj", "data"), { recursive: true })
	for (const rel of ["data/a.geojson", "data/b.geojson", "c.geojson"]) await fs.writeFile(path.join(root, "proj", rel), `{"x":"${rel}"}`)
	diskFiles = ["data/a.geojson", "data/b.geojson", "c.geojson"].map((rel) => fileAt(folders[0], rel))
	store = memento()
})
afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true })
})

const names = (r: { files: { relativePath: string }[] }) => r.files.map((f) => f.relativePath)
const req = (rel: string, folder = folders[0].path, kind = "file") => ({ entries: [{ workspaceFolder: folder, relativePath: rel, kind }], all: false })

describe("project files list", () => {
	it("lists every file with its size, and says what the scan skipped", async () => {
		const r = await listProjectFiles(host())
		expect(names(r)).to.deep.equal(["data/a.geojson", "data/b.geojson", "c.geojson"])
		expect(r.files[0].sizeBytes).to.equal(10)
		expect(r).to.include({ foldersSkipped: 2, symlinksFound: 1, symlinksSkipped: 1, truncated: false, folderCount: 1 })
		expect(r.skippedNames).to.deep.equal([".git", "node_modules"])
	})

	it("Remove from list hides a file, keeps it findable under removed, and the file stays on disk byte for byte", async () => {
		const before = await fs.readFile(path.join(folders[0].path, "data/a.geojson"), "utf8")
		expect(await changeFileList(host(), req("data/a.geojson"), "remove")).to.equal(1)
		const r = await listProjectFiles(host())
		expect(names(r)).to.not.include("data/a.geojson")
		expect(r.removed.map((e) => e.relativePath)).to.deep.equal(["data/a.geojson"])
		expect(r.removed[0].workspaceFolder).to.equal(folders[0].path)
		expect(await fs.readFile(path.join(folders[0].path, "data/a.geojson"), "utf8")).to.equal(before)
	})

	it("survives a rescan and a window reload: a new host over the same store still hides it, and Restore brings it back", async () => {
		await changeFileList(host(), req("c.geojson"), "remove")
		diskFiles = diskFiles.map((f) => ({ ...f, lastModified: 2000 }) as WorkspaceGeoJsonFile) // the file changed; still removed
		expect(names(await listProjectFiles(host()))).to.not.include("c.geojson")
		expect(await changeFileList(host(), req("c.geojson"), "restore")).to.equal(1)
		expect(names(await listProjectFiles(host()))).to.include("c.geojson")
	})

	it("Remove folder hides everything under it; Restore all empties the removed list", async () => {
		await changeFileList(host(), req("data", folders[0].path, "folder"), "remove")
		expect(names(await listProjectFiles(host()))).to.deep.equal(["c.geojson"])
		await changeFileList(host(), { entries: [], all: true }, "restore")
		expect(names(await listProjectFiles(host()))).to.have.length(3)
		expect((await listProjectFiles(host())).removed).to.have.length(0)
	})

	it("stores only a folder hash and a relative path: no absolute path reaches the global state", async () => {
		await changeFileList(host(), req("data/a.geojson"), "remove")
		const raw = JSON.stringify(store.data)
		expect(raw).to.not.contain(root)
		expect(raw).to.not.contain(os.tmpdir())
		expect(Object.keys(store.data)).to.deep.equal([`${REMOVED_KEY_PREFIX}dir:test`])
		expect(raw).to.contain(await folderHashOf(folders[0].path))
	})

	it("ignores an entry for a folder this window does not have open", async () => {
		expect(await changeFileList(host(), req("data/a.geojson", path.join(root, "elsewhere")), "remove")).to.equal(0)
	})

	it("multi-root: one removed list for the window, entries tell the folders apart, and rows carry the folder name", async () => {
		const second = { path: path.join(root, "other"), name: "other" }
		await fs.mkdir(second.path)
		folders = [folders[0], second]
		diskFiles = [...diskFiles, fileAt(second, "data/a.geojson")]
		await changeFileList(host(), req("data/a.geojson", second.path), "remove")
		const r = await listProjectFiles(host())
		expect(r.files.filter((f) => f.relativePath === "data/a.geojson").map((f) => f.folderName)).to.deep.equal(["proj"])
		expect(r.removed[0]).to.include({ folderName: "other", workspaceFolder: second.path })
		expect(r.folderCount).to.equal(2)
		expect(Object.keys(store.data)).to.have.length(1)
	})

	it("never deletes a file: remove, restore, and an unload sidecar leave every file as it was", async () => {
		const snapshot = async () => {
			const out: Record<string, string> = {}
			for (const rel of ["data/a.geojson", "data/b.geojson", "c.geojson"]) out[rel] = await fs.readFile(path.join(folders[0].path, rel), "utf8")
			return out
		}
		const before = await snapshot()
		await changeFileList(host(), req("data/a.geojson"), "remove")
		await changeFileList(host(), req("data", folders[0].path, "folder"), "remove")
		await changeFileList(host(), { entries: [], all: true }, "restore")
		await saveUnloaded(folders[0].path, path.join(folders[0].path, "c.geojson"), { layer_id: "L", name: "c", layer_type: "polygon", unloaded_at: 1 }, root)
		expect(await peekUnloaded(folders[0].path, path.join(folders[0].path, "c.geojson"), root)).to.not.equal(undefined)
		expect(await snapshot()).to.deep.equal(before)
	})
})

describe("no code of this feature deletes a file", () => {
	const FEATURE_FILES = [
		"src/core/map/mapFileListStore.ts",
		"src/core/map/projectFiles.ts",
		"src/core/map/unloadedLayerSidecar.ts",
		"src/core/map/authorizeMapPath.ts",
		"src/core/workspace/FileScanner.ts",
		"src/core/workspace/geoSniff.ts",
		"src/core/controller/map/removeFromFileList.ts",
		"src/core/controller/map/restoreToFileList.ts",
		"src/core/controller/map/unloadMapLayer.ts",
		"src/core/controller/map/addWorkspaceGeoFile.ts",
		"src/core/controller/map/listWorkspaceGeoFiles.ts",
		"src/shared/map/projectFiles.ts",
	]
	// Anything that can remove a path: fs.unlink / rm / rmdir / rmSync / unlinkSync, workspace.fs.delete, trashItem.
	const DELETES = /\b(?:unlink|unlinkSync|rmSync|rmdir|rmdirSync|trashItem)\b|\bfs\.rm\b|\.rm\(|workspace\.fs\.delete|\.delete\(\s*(?:vscode\.)?Uri/
	for (const file of FEATURE_FILES) {
		it(`${file} has no call that deletes a file`, async () => {
			const text = await fs.readFile(path.join(__dirname, "../../../..", file), "utf8")
			expect(DELETES.test(text), `${file} matched ${DELETES}`).to.equal(false)
		})
	}
})
