import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { writeDerivedGeojson } from "../derivedWrite"

let root: string
let a: string
let b: string
beforeEach(async () => {
	root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "aih-derived-")))
	a = path.join(root, "a")
	b = path.join(root, "b")
	await fs.mkdir(a)
	await fs.mkdir(b)
})
afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true })
})
const input = (sourcePath: string, geojson = '{"type":"FeatureCollection","features":[]}') => ({
	folders: [a, b],
	fallbackDir: path.join(root, "global"),
	sourcePath,
	name: "basin.geojson",
	geojson,
	provenance: { source: { path: sourcePath }, format: "kmz", warnings: [] as string[] },
})

describe("derived writes", () => {
	it("go next to the source's own folder, not the first folder of the window", async () => {
		const r = await writeDerivedGeojson(input(path.join(b, "data", "basin.kmz")))
		expect(r.artifactPath.startsWith(path.join(b, ".aihydro", "map-derived"))).to.equal(true)
		await fs.access(r.provenancePath)
		await fs.access(path.join(a, ".aihydro")).then(
			() => expect.fail("first folder was written"),
			() => undefined,
		)
	})

	it("name the file with a short hash of the source path, so two sources with one name never collide", async () => {
		const one = await writeDerivedGeojson(input(path.join(a, "x", "basin.kmz")))
		const two = await writeDerivedGeojson(input(path.join(a, "y", "basin.kmz")))
		expect(one.artifactPath).to.not.equal(two.artifactPath)
		expect(path.basename(one.artifactPath)).to.match(/^basin-[0-9a-f]{8}\.geojson$/)
		const prov = JSON.parse(await fs.readFile(one.provenancePath, "utf8"))
		expect(prov.source.path).to.equal(path.join(a, "x", "basin.kmz"))
	})

	it("skips the write when the content hash already matches", async () => {
		const first = await writeDerivedGeojson(input(path.join(a, "x", "basin.kmz")))
		const before = await fs.stat(first.provenancePath)
		await new Promise((r) => setTimeout(r, 20))
		const again = await writeDerivedGeojson(input(path.join(a, "x", "basin.kmz")))
		expect(again.unchanged).to.equal(true)
		expect((await fs.stat(first.provenancePath)).mtimeMs).to.equal(before.mtimeMs)
		const changed = await writeDerivedGeojson(input(path.join(a, "x", "basin.kmz"), '{"type":"FeatureCollection","features":[1]}'))
		expect(changed.unchanged).to.equal(false)
	})

	it("never overwrites another source's provenance", async () => {
		const src = path.join(a, "x", "basin.kmz")
		const r = await writeDerivedGeojson(input(src))
		const prov = JSON.parse(await fs.readFile(r.provenancePath, "utf8"))
		prov.source.path = path.join(a, "someone-else.kmz")
		await fs.writeFile(r.provenancePath, JSON.stringify(prov))
		let message = ""
		await writeDerivedGeojson(input(src, '{"type":"FeatureCollection","features":[2]}')).catch((e) => {
			message = String(e.message)
		})
		expect(message).to.contain("different source")
		expect(JSON.parse(await fs.readFile(r.provenancePath, "utf8")).source.path).to.equal(path.join(a, "someone-else.kmz"))
	})

	it("falls back to the global directory only when no folder is open", async () => {
		const r = await writeDerivedGeojson({ ...input("/elsewhere/x.kmz"), folders: [] })
		expect(r.artifactPath.startsWith(path.join(root, "global", "map-derived"))).to.equal(true)
	})
})
