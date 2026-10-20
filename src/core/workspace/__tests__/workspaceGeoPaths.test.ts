import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { isPathInside, realPathInsideFolder, workspaceGeoFileKey } from "../workspaceGeoPaths"

describe("workspaceGeoPaths", () => {
	let root: string
	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-geopaths-"))
	})
	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	it("keys files by folder and relative path, so equal relative paths in two folders differ", () => {
		expect(workspaceGeoFileKey("/one", "data/a.geojson")).to.not.equal(workspaceGeoFileKey("/two", "data/a.geojson"))
		expect(workspaceGeoFileKey("/one", "data/a.geojson")).to.equal(workspaceGeoFileKey("/one", "data/a.geojson"))
	})

	it("isPathInside accepts the folder and descendants and rejects siblings and parents", () => {
		expect(isPathInside("/a/b", "/a/b")).to.equal(true)
		expect(isPathInside("/a/b", "/a/b/c/d")).to.equal(true)
		expect(isPathInside("/a/b", "/a/bc")).to.equal(false)
		expect(isPathInside("/a/b", "/a")).to.equal(false)
	})

	it("returns the real path for an ordinary file and rejects a symlink that leaves the folder", async () => {
		const folder = path.join(root, "ws")
		const outside = path.join(root, "outside")
		await fs.mkdir(folder)
		await fs.mkdir(outside)
		await fs.writeFile(path.join(folder, "ok.geojson"), "{}")
		await fs.writeFile(path.join(outside, "secret.geojson"), "{}")
		await fs.symlink(path.join(outside, "secret.geojson"), path.join(folder, "link.geojson"))
		await fs.symlink(path.join(folder, "ok.geojson"), path.join(folder, "inner-link.geojson"))

		expect(await realPathInsideFolder(folder, path.join(folder, "ok.geojson"))).to.equal(
			await fs.realpath(path.join(folder, "ok.geojson")),
		)
		expect(await realPathInsideFolder(folder, path.join(folder, "link.geojson"))).to.equal(null)
		expect(await realPathInsideFolder(folder, path.join(folder, "inner-link.geojson"))).to.be.a("string")
		expect(await realPathInsideFolder(folder, path.join(folder, "missing.geojson"))).to.equal(null)
	})
})
