import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { authorizeMapPath, clearMapPathGrants, grantMapPath } from "../authorizeMapPath"

let root: string
let ws: string
let aih: string
let outside: string
beforeEach(async () => {
	root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "aih-auth-")))
	ws = path.join(root, "ws")
	aih = path.join(root, "aih")
	outside = path.join(root, "outside")
	for (const d of [ws, aih, outside]) await fs.mkdir(d)
	await fs.writeFile(path.join(ws, "a.geojson"), "{}")
	await fs.writeFile(path.join(outside, "secret.geojson"), "{}")
	clearMapPathGrants()
})
afterEach(async () => {
	clearMapPathGrants()
	await fs.rm(root, { recursive: true, force: true })
})
const deps = (extra: Partial<Parameters<typeof authorizeMapPath>[2]> = {}) => ({
	workspaceFolders: () => [ws],
	aihydroDirs: () => [aih],
	...extra,
})

describe("authorizeMapPath", () => {
	it("allows a file in an open folder and one in AI-Hydro's own directory", async () => {
		const a = await authorizeMapPath(path.join(ws, "a.geojson"), "load", deps())
		expect(a).to.include({ ok: true, via: "workspace" })
		const b = await authorizeMapPath(path.join(aih, "cache.geojson"), "read", deps())
		expect(b).to.include({ ok: true, via: "aihydro" })
	})

	it("refuses a file outside, a relative path, an empty path and a NUL byte", async () => {
		for (const p of [path.join(outside, "secret.geojson"), "data/a.geojson", "", `${ws}/a\0.geojson`]) {
			expect((await authorizeMapPath(p, "read", deps())).ok, JSON.stringify(p)).to.equal(false)
		}
	})

	it("refuses a path that climbs out of the folder with ..", async () => {
		const sneaky = path.join(ws, "..", "outside", "secret.geojson")
		expect((await authorizeMapPath(sneaky, "read", deps())).ok).to.equal(false)
	})

	it("follows a symlink: a link inside the folder to a file outside is refused", async () => {
		const link = path.join(ws, "link.geojson")
		await fs.symlink(path.join(outside, "secret.geojson"), link)
		expect((await authorizeMapPath(link, "read", deps())).ok).to.equal(false)
	})

	it("allows a file the user picked, once granted, by any spelling of its path", async () => {
		const secret = path.join(outside, "secret.geojson")
		expect((await authorizeMapPath(secret, "load", deps())).ok).to.equal(false)
		grantMapPath(secret)
		expect(await authorizeMapPath(secret, "load", deps())).to.include({ ok: true, via: "granted" })
		expect((await authorizeMapPath(path.join(outside, ".", "secret.geojson"), "load", deps())).ok).to.equal(true)
	})

	it("lets a file already on the map be read or opened, but never loaded as new", async () => {
		const secret = path.join(outside, "secret.geojson")
		const d = deps({ onMapPaths: () => [secret] })
		expect(await authorizeMapPath(secret, "read", d)).to.include({ ok: true, via: "on-map" })
		expect((await authorizeMapPath(secret, "open", d)).ok).to.equal(true)
		expect((await authorizeMapPath(secret, "load", d)).ok).to.equal(false)
	})

	it("returns the resolved path, so the read names the file that was checked", async () => {
		const link = path.join(ws, "same.geojson")
		await fs.symlink(path.join(ws, "a.geojson"), link)
		const decision = await authorizeMapPath(link, "read", deps())
		expect(decision.ok && decision.path).to.equal(path.join(ws, "a.geojson"))
	})
})
