import { expect } from "chai"
import * as fs from "fs"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { resolveMapFilePath } from "../resolveMapFilePath"

describe("resolveMapFilePath: a named project file is read from that file", () => {
	let root: string
	let project: string
	let cache: string
	const exists = async (p: string) => fs.existsSync(p)
	const deps = () => ({ homedir: root, workspaceFolders: [project], cacheDirs: [cache], exists })

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "aih-resolve-"))
		project = path.join(root, "proj")
		cache = path.join(root, "aihydro", "map_layer_geojson_cache")
		fs.mkdirSync(project, { recursive: true })
		fs.mkdirSync(cache, { recursive: true })
	})
	afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

	it("picks the project file when a cache copy under the same name differs", async () => {
		fs.writeFileSync(path.join(project, "watershed_01013500.geojson"), '{"type":"Polygon","coordinates":[[0,0]]}')
		fs.writeFileSync(path.join(cache, "watershed_01013500.geojson"), '{"type":"Polygon","coordinates":[[9,9]]}')
		const resolved = await resolveMapFilePath("watershed_01013500.geojson", deps(), { kind: "project" })
		expect(resolved).to.equal(path.join(project, "watershed_01013500.geojson"))
		expect(fs.readFileSync(resolved, "utf8")).to.contain("[[0,0]]")
	})

	it("tries the folder the layer recorded before the others", async () => {
		const other = path.join(root, "other")
		fs.mkdirSync(other)
		fs.writeFileSync(path.join(other, "a.geojson"), "{}")
		fs.writeFileSync(path.join(project, "a.geojson"), "{}")
		expect(await resolveMapFilePath("a.geojson", deps(), { workspaceFolder: other, kind: "project" })).to.equal(
			path.join(other, "a.geojson"),
		)
	})

	it("a layer's own folder is the only folder tried: another folder's same-named file is not substituted", async () => {
		const other = path.join(root, "other")
		fs.mkdirSync(other)
		fs.writeFileSync(path.join(project, "a.geojson"), "{}")
		// The layer says its file is under `other`, where it is no longer. The project folder's a.geojson is a different file.
		expect(await resolveMapFilePath("a.geojson", deps(), { workspaceFolder: other, kind: "project" })).to.equal("a.geojson")
	})

	it("kinds do not guess across each other: a project path never gets a cache copy, nor a cache path a project file", async () => {
		fs.writeFileSync(path.join(cache, "n.geojson"), "{}")
		fs.writeFileSync(path.join(project, "m.geojson"), "{}")
		expect(await resolveMapFilePath("n.geojson", deps(), { kind: "project" })).to.equal("n.geojson")
		expect(await resolveMapFilePath("m.geojson", deps(), { kind: "cache" })).to.equal("m.geojson")
		expect(await resolveMapFilePath("n.geojson", deps(), { kind: "cache" })).to.equal(path.join(cache, "n.geojson"))
		expect(await resolveMapFilePath("m.geojson", deps(), { kind: "project" })).to.equal(path.join(project, "m.geojson"))
	})

	it("uses the cache copy only when no project file has that name", async () => {
		fs.writeFileSync(path.join(cache, "only_cached.geojson"), "{}")
		expect(await resolveMapFilePath("only_cached.geojson", deps())).to.equal(path.join(cache, "only_cached.geojson"))
	})

	it("returns an absolute path as it is, and expands ~", async () => {
		expect(await resolveMapFilePath(path.join(project, "x.geojson"), deps())).to.equal(path.join(project, "x.geojson"))
		fs.writeFileSync(path.join(root, "h.geojson"), "{}")
		expect(await resolveMapFilePath("~/h.geojson", deps())).to.equal(path.join(root, "h.geojson"))
	})

	it("returns the path it was given when nothing is found", async () => {
		expect(await resolveMapFilePath("missing.geojson", deps())).to.equal("missing.geojson")
	})
})
