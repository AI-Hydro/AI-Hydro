import { MapLayer } from "@shared/proto/cline/map"
import { expect } from "chai"
import * as fs from "fs"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { buildMapLayerCatalogAsync, catalogWork, layerToCatalogEntry } from "../mapLayerCatalog"

/** Rewriting the catalog (every style edit does) must not redo work on content that did not change. Scratch HOME only. */
const featureCollection = (seed: number, bytes: number) => {
	const features: unknown[] = []
	let size = 0
	for (let i = 0; size < bytes; i++) {
		const f = { type: "Feature", properties: { id: i, area: seed + i * 1.5, name: `f${i}` }, geometry: { type: "Point", coordinates: [seed + i * 0.001, 40 + i * 0.001] } }
		features.push(f)
		size += JSON.stringify(f).length + 1
	}
	return JSON.stringify({ type: "FeatureCollection", features })
}

describe("catalog rewrite: unchanged content is not redone", () => {
	let home: string
	let saved: string | undefined
	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "aih-catalog-"))
		saved = process.env.AIHYDRO_HOME
		process.env.AIHYDRO_HOME = home
	})
	afterEach(() => {
		if (saved === undefined) delete process.env.AIHYDRO_HOME
		else process.env.AIHYDRO_HOME = saved
		fs.rmSync(home, { recursive: true, force: true })
	})

	const layers = (n: number, bytes: number) =>
		Array.from({ length: n }, (_, i) =>
			MapLayer.create({
				id: `layer-${i}`,
				name: `layer ${i}`,
				geojson: featureCollection(i, bytes),
				layerType: "polygon",
				visible: true,
				metadata: { source: "user" },
			}),
		)

	it("a style edit at 40 layers of 500 KB parses, caches and previews nothing again", async function () {
		this.timeout(60_000)
		const ls = layers(40, 500_000)
		const order = ls.map((l) => l.id)
		const t0 = Date.now()
		await buildMapLayerCatalogAsync(ls, order)
		const first = Date.now() - t0
		const before = { ...catalogWork }
		expect(before.summaries).to.equal(40)
		expect(before.cacheWrites).to.equal(40)
		// A style edit: one layer's metadata changes, its content does not.
		const edited = ls.map((l, i) => (i === 7 ? MapLayer.create({ ...l, metadata: { ...l.metadata, display_name: "renamed" } }) : l))
		const t1 = Date.now()
		await buildMapLayerCatalogAsync(edited, order)
		const second = Date.now() - t1
		console.log(`      catalog rewrite, 40 layers x 500 KB: first ${first} ms, after a style edit ${second} ms`)
		expect(catalogWork.summaries).to.equal(before.summaries)
		expect(catalogWork.cacheWrites).to.equal(before.cacheWrites)
		expect(catalogWork.previews).to.equal(before.previews)
		// Changed content is redone, once.
		const changed = edited.map((l, i) => (i === 3 ? MapLayer.create({ ...l, geojson: featureCollection(99, 500_000) }) : l))
		await buildMapLayerCatalogAsync(changed, order)
		expect(catalogWork.summaries).to.equal(before.summaries + 1)
		expect(catalogWork.cacheWrites).to.equal(before.cacheWrites + 1)
	})

	it("a cache copy that was deleted is written again", async () => {
		const [layer] = layers(1, 5_000)
		const first = await buildMapLayerCatalogAsync([layer], [layer.id])
		fs.rmSync(first.layers[0].geojson_cache_path)
		const again = await buildMapLayerCatalogAsync([layer], [layer.id])
		expect(fs.existsSync(again.layers[0].geojson_cache_path)).to.equal(true)
	})

	it("a workspace file's path is stored absolute with its folder", () => {
		const layer = MapLayer.create({
			id: "workspace_a",
			name: "a.geojson",
			geojson: "",
			layerType: "polygon",
			metadata: { source: "workspace", path: "data/a.geojson", workspace_folder: "/w/proj" },
		})
		expect(layerToCatalogEntry(layer).workspace_path).to.equal("/w/proj/data/a.geojson")
		expect(layerToCatalogEntry(layer).metadata_snapshot.path).to.equal("data/a.geojson")
	})
})
