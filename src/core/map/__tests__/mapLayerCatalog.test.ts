import { MapLayer } from "@shared/proto/cline/map"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import {
	buildMapLayerCatalog,
	buildMapLayerCatalogAsync,
	extractNumericAttributes,
	layerToCatalogEntry,
	type MapLayerCatalog,
	persistMapLayerCatalog,
	readMapLayerCatalog,
	scopedMapLayerCatalogFile,
} from "../mapLayerCatalog"
import { MAX_RESTORED_LAYERS, selectCatalogEntriesToRestore } from "../restoreSelection"

describe("mapLayerCatalog", () => {
	it("extractNumericAttributes finds numeric property columns", () => {
		const geojson = JSON.stringify({
			type: "FeatureCollection",
			features: [
				{ type: "Feature", properties: { twi: 5.2, name: "a" }, geometry: null },
				{ type: "Feature", properties: { twi: 8.1, name: "b" }, geometry: null },
			],
		})
		const attrs = extractNumericAttributes(geojson)
		expect(attrs.some((a) => a.name === "twi")).to.equal(true)
		expect(attrs.find((a) => a.name === "twi")?.min).to.be.closeTo(5.2, 0.01)
	})

	it("layerToCatalogEntry reports graduated symbology mode", () => {
		const layer = MapLayer.create({
			id: "l1",
			name: "Grid",
			geojson: '{"type":"FeatureCollection","features":[{"properties":{"twi":1}}]}',
			layerType: "polygon",
			metadata: {
				graduated_attr: "twi",
				graduated_breaks: "[1,5,10]",
				graduated_method: "quantile",
			},
		})
		const entry = layerToCatalogEntry(layer)
		expect(entry.symbology_mode).to.equal("graduated")
		expect(entry.graduated?.attr).to.equal("twi")
	})

	it("buildMapLayerCatalog preserves layer order", () => {
		const layers = [
			MapLayer.create({ id: "b", name: "B", geojson: "{}", layerType: "polygon" }),
			MapLayer.create({ id: "a", name: "A", geojson: "{}", layerType: "polygon" }),
		]
		const catalog = buildMapLayerCatalog(layers, ["a", "b"])
		expect(catalog.layer_order).to.deep.equal(["a", "b"])
		expect(catalog.layers.map((l) => l.id)).to.deep.equal(["a", "b"])
	})
})

describe("mapLayerCatalog overflow and legacy migration", () => {
	let dir: string
	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "aih-catalog-"))
	})
	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})
	const geo = (id: string) =>
		MapLayer.create({ id, name: id, geojson: "", layerType: "polygon", metadata: { path: `/abs/${id}.geojson` } })

	it("a rewrite from the live layers keeps entries beyond the restore cap on disk", async () => {
		const ids = Array.from({ length: MAX_RESTORED_LAYERS + 10 }, (_, i) => `l${i}`)
		const full: MapLayerCatalog = await buildMapLayerCatalogAsync(ids.map(geo), ids, "/ws")
		const selection = selectCatalogEntriesToRestore(full, "/ws")
		expect(selection.overflow).to.have.length(10)

		// Only the capped layers are live; the controller passes the overflow through every rewrite.
		const live = selection.entries.map((e) => geo(e.id))
		const rewritten = await buildMapLayerCatalogAsync(
			live,
			live.map((l) => l.id),
			"/ws",
			selection.overflow,
		)
		await persistMapLayerCatalog(rewritten, dir)
		const onDisk = await readMapLayerCatalog("/ws", dir)
		expect(onDisk?.layers.map((l) => l.id)).to.deep.equal(ids)
		expect(onDisk?.layer_order).to.deep.equal(ids)

		// A later rewrite after the user removed a live layer still keeps all overflow entries.
		const fewer = live.slice(1)
		const again = await buildMapLayerCatalogAsync(
			fewer,
			fewer.map((l) => l.id),
			"/ws",
			selection.overflow,
		)
		expect(again.layers.map((l) => l.id)).to.deep.equal([...selection.overflow.map((e) => e.id), ...fewer.map((l) => l.id)])
	})

	it("an overflow entry whose layer is live is not duplicated", async () => {
		const first = await buildMapLayerCatalogAsync([geo("a"), geo("b")], ["a", "b"], "/ws")
		const again = await buildMapLayerCatalogAsync([geo("a")], ["a"], "/ws", first.layers)
		expect(again.layers.map((l) => l.id).filter((id) => id === "a")).to.have.length(1)
	})

	it("the legacy global catalog is migrated into the first workspace that loads it, then marked migrated", async () => {
		const legacy: MapLayerCatalog = {
			updated_at_ms: 1,
			layer_order: ["x"],
			layers: (await buildMapLayerCatalogAsync([geo("x")], ["x"])).layers,
		}
		await fs.writeFile(path.join(dir, "map_layer_catalog.json"), JSON.stringify(legacy))

		const first = await readMapLayerCatalog("/ws-a", dir)
		expect(first?.layers.map((l) => l.id)).to.deep.equal(["x"])
		expect(first?.workspace_root).to.equal("/ws-a")
		// Legacy file renamed; scoped file written for workspace A.
		const names = await fs.readdir(dir)
		expect(names).to.include("map_layer_catalog.migrated.json")
		expect(names).to.not.include("map_layer_catalog.json")
		expect(await fs.readFile(scopedMapLayerCatalogFile("/ws-a", dir), "utf8")).to.contain('"x"')

		// A second workspace does not re-import it.
		expect(await readMapLayerCatalog("/ws-b", dir)).to.equal(null)
		// The first workspace keeps reading its own scoped file.
		expect((await readMapLayerCatalog("/ws-a", dir))?.layers.map((l) => l.id)).to.deep.equal(["x"])
	})

	it("a workspace with its own catalog never touches the legacy file", async () => {
		await persistMapLayerCatalog(await buildMapLayerCatalogAsync([geo("own")], ["own"], "/ws-a"), dir)
		await fs.writeFile(
			path.join(dir, "map_layer_catalog.json"),
			JSON.stringify({ updated_at_ms: 1, layer_order: [], layers: [] }),
		)
		expect((await readMapLayerCatalog("/ws-a", dir))?.layers.map((l) => l.id)).to.deep.equal(["own"])
		expect(await fs.readdir(dir)).to.include("map_layer_catalog.json")
	})
})
