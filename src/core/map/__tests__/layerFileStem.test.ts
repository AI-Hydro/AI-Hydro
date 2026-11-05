import { MapLayer } from "@shared/proto/cline/map"
import { expect } from "chai"
import * as fs from "fs"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { layerFileStem } from "../layerFileStem"
import { buildMapLayerCatalogAsync } from "../mapLayerCatalog"

describe("cache file names", () => {
	let home: string
	let saved: string | undefined
	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "aih-stem-"))
		saved = process.env.AIHYDRO_HOME
		process.env.AIHYDRO_HOME = home
	})
	afterEach(() => {
		if (saved === undefined) delete process.env.AIHYDRO_HOME
		else process.env.AIHYDRO_HOME = saved
		fs.rmSync(home, { recursive: true, force: true })
	})

	it("keeps a safe id and tells apart ids that only differ in characters that were replaced", () => {
		expect(layerFileStem("user-a_b")).to.equal("user-a_b")
		expect(layerFileStem("run:x")).to.not.equal(layerFileStem("run_x"))
		expect(layerFileStem("run:x")).to.match(/^run_x-[0-9a-f]{8}$/)
	})

	it("two layers whose ids differ only by punctuation keep two cache files, each with its own content", async () => {
		const mk = (id: string, n: number) =>
			MapLayer.create({
				id,
				name: id,
				geojson: JSON.stringify({ type: "Point", coordinates: [n, n] }),
				layerType: "point",
				metadata: { source: "user" },
			})
		const catalog = await buildMapLayerCatalogAsync([mk("run:x", 1), mk("run_x", 2)], ["run:x", "run_x"])
		const [a, b] = catalog.layers.map((l) => l.geojson_cache_path)
		expect(a).to.not.equal(b)
		expect(JSON.parse(fs.readFileSync(a, "utf8")).coordinates).to.deep.equal([1, 1])
		expect(JSON.parse(fs.readFileSync(b, "utf8")).coordinates).to.deep.equal([2, 2])
		expect(a.startsWith(home)).to.equal(true)
	})
})
