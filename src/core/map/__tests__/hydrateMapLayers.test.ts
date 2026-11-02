import { applyAddLayer, type LayerStoreState } from "@core/map/applyAddLayer"
import { MapLayer } from "@shared/proto/cline/map"
import { expect } from "chai"
import * as fs from "fs"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { hydrateMapLayersFromCatalog, readEntryGeojson } from "../hydrateMapLayers"
import {
	buildMapLayerCatalogAsync,
	type MapLayerCatalog,
	type MapLayerCatalogEntry,
	persistMapLayerCatalog,
} from "../mapLayerCatalog"

/** Restore reads the file a layer names, keeps a cached layer across restarts, and keeps ids apart. Scratch dirs only. */
const POLYGON = (n: number) => ({
	type: "Polygon",
	coordinates: [
		[
			[n, n],
			[n + 1, n],
			[n + 1, n + 1],
			[n, n],
		],
	],
})

const entry = (over: Partial<MapLayerCatalogEntry> & Pick<MapLayerCatalogEntry, "id" | "name">): MapLayerCatalogEntry => ({
	layer_type: "polygon",
	visible: true,
	source: "workspace",
	workspace_path: "",
	geojson_cache_path: "",
	raster_path: "",
	raster_bounds: "",
	raster_colormap: "viridis",
	raster_opacity: "0.75",
	inundation_3d_manifest_path: "",
	style: { fillColor: "#0066CC", strokeColor: "#003399" },
	symbology_mode: "basic",
	numeric_attributes: [],
	feature_count: 1,
	metadata_snapshot: {},
	...over,
})

describe("hydrateMapLayers: the file a layer names is the file it shows", () => {
	let home: string
	let project: string
	let cacheDir: string
	let savedHome: string | undefined

	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "aih-hyd-home-"))
		project = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aih-hyd-proj-")), "try")
		fs.mkdirSync(project, { recursive: true })
		savedHome = process.env.AIHYDRO_HOME
		process.env.AIHYDRO_HOME = home
		cacheDir = path.join(home, "map_layer_geojson_cache")
		fs.mkdirSync(cacheDir, { recursive: true })
	})
	afterEach(() => {
		if (savedHome === undefined) delete process.env.AIHYDRO_HOME
		else process.env.AIHYDRO_HOME = savedHome
		fs.rmSync(home, { recursive: true, force: true })
		fs.rmSync(path.dirname(project), { recursive: true, force: true })
	})

	const controller = () => {
		const state: LayerStoreState = { layers: new Map(), order: [], aliases: new Map() }
		return {
			state,
			setMapOverflowEntries() {},
			recordRestoreMerges() {},
			addMapLayer(layer: MapLayer) {
				applyAddLayer(state, layer)
			},
		}
	}
	const workspaceEntry = (extra: Partial<MapLayerCatalogEntry> = {}) =>
		entry({
			id: "workspace_a",
			name: "a.geojson",
			workspace_path: "a.geojson",
			metadata_snapshot: { source: "workspace", path: "a.geojson", workspace_folder: project },
			...extra,
		})
	const persist = (layers: MapLayerCatalogEntry[]) =>
		persistMapLayerCatalog({ workspace_root: project, updated_at_ms: 1, layer_order: layers.map((l) => l.id), layers }, home)

	it("reads the project file, not a same-named cache copy that differs", async () => {
		fs.writeFileSync(path.join(project, "a.geojson"), JSON.stringify(POLYGON(1)))
		fs.writeFileSync(path.join(cacheDir, "a.geojson"), JSON.stringify(POLYGON(99)))
		const e = workspaceEntry()
		const read = await readEntryGeojson(e, e.metadata_snapshot)
		expect(read?.from).to.equal("file")
		expect(JSON.parse(read?.raw ?? "null")).to.deep.equal(POLYGON(1))
	})

	it("does not stamp a project path into geojson_cache_path, which the map draws in preference to the file", async () => {
		fs.writeFileSync(path.join(project, "a.geojson"), JSON.stringify(POLYGON(1)))
		fs.writeFileSync(path.join(cacheDir, "a.geojson"), JSON.stringify(POLYGON(99)))
		await persist([workspaceEntry()])
		const c = controller()
		await hydrateMapLayersFromCatalog(c as any, project)
		const layer = c.state.layers.get("workspace_a")
		expect(layer, "restored").to.not.equal(undefined)
		expect(layer?.metadata.geojson_cache_path).to.equal("")
		expect(layer?.metadata.source_status).to.not.equal("source_missing")
	})

	it("falls back to the cache copy only when the file is gone, and says so", async () => {
		const copy = path.join(cacheDir, "workspace_a.geojson")
		fs.writeFileSync(copy, JSON.stringify(POLYGON(5)))
		const e = workspaceEntry({ geojson_cache_path: copy })
		const read = await readEntryGeojson(e, e.metadata_snapshot)
		expect(read?.from).to.equal("cache")
		await persist([e])
		const c = controller()
		await hydrateMapLayersFromCatalog(c as any, project)
		expect(c.state.layers.get("workspace_a")?.metadata.source_status).to.equal("source_missing")
	})

	it("a relative workspace path is never looked up in the cache directory", async () => {
		fs.writeFileSync(path.join(cacheDir, "a.geojson"), JSON.stringify(POLYGON(99)))
		const e = workspaceEntry({ metadata_snapshot: { source: "workspace", path: "a.geojson" } })
		// No folder recorded and no file: nothing to read. The cache's unrelated "a.geojson" is not a candidate.
		expect(await readEntryGeojson(e, e.metadata_snapshot)).to.equal(null)
	})

	it("a named file edited between sessions is not drawn from the old preview", async () => {
		const many = (v: number) =>
			JSON.stringify({
				type: "FeatureCollection",
				features: Array.from({ length: 10_100 }, (_, i) => ({
					type: "Feature",
					properties: { v, i },
					geometry: { type: "Point", coordinates: [i * 0.001, 0] },
				})),
			})
		const file = path.join(project, "a.geojson")
		fs.writeFileSync(file, many(1))
		await persist([workspaceEntry()])
		const first = controller()
		await hydrateMapLayersFromCatalog(first as any, project)
		const firstPreview = first.state.layers.get("workspace_a")?.metadata.display_geojson_path
		expect(firstPreview, "a file over the preview threshold gets one").to.be.a("string")
		expect(firstPreview?.startsWith(home)).to.equal(true) // scratch AIHYDRO_HOME, never the real one
		expect(JSON.parse(fs.readFileSync(firstPreview as string, "utf8")).features[0].properties.v).to.equal(1)
		// The catalog now names that preview. The file changes before the next session.
		await persistMapLayerCatalog(
			await buildMapLayerCatalogAsync([...first.state.layers.values()], first.state.order, project),
			home,
		)
		fs.writeFileSync(file, many(2))
		const second = controller()
		await hydrateMapLayersFromCatalog(second as any, project)
		const preview = second.state.layers.get("workspace_a")?.metadata.display_geojson_path as string
		expect(JSON.parse(fs.readFileSync(preview, "utf8")).features[0].properties.v).to.equal(2)
	})

	it("a tool's layer keeps the preview it was given", async () => {
		const copy = path.join(cacheDir, "tool_p.geojson")
		fs.writeFileSync(copy, JSON.stringify(POLYGON(5)))
		const e = entry({
			id: "tool_p",
			name: "p",
			source: "tool",
			geojson_cache_path: copy,
			metadata_snapshot: {
				tool: "extract_rivers",
				_run_id: "run-3.1",
				display_geojson_path: "/scratch/keep.preview.geojson",
				display_mode: "preview",
			},
		})
		await persist([e])
		const c = controller()
		await hydrateMapLayersFromCatalog(c as any, project)
		expect(c.state.layers.get("tool_p")?.metadata.display_geojson_path).to.equal("/scratch/keep.preview.geojson")
	})

	it("a tool's layer reads its cache copy first: the file may have been overwritten since the run", async () => {
		const copy = path.join(cacheDir, "tool_a.geojson")
		fs.writeFileSync(copy, JSON.stringify(POLYGON(5)))
		fs.writeFileSync(path.join(project, "out.geojson"), JSON.stringify(POLYGON(6)))
		const e = entry({
			id: "tool_a",
			name: "out",
			source: "tool",
			geojson_cache_path: copy,
			metadata_snapshot: {
				tool: "delineate_watershed",
				_run_id: "run-1.1",
				source_path: path.join(project, "out.geojson"),
			},
		})
		const read = await readEntryGeojson(e, e.metadata_snapshot)
		expect(read?.from).to.equal("cache")
		expect(JSON.parse(read?.raw ?? "null")).to.deep.equal(POLYGON(5))
	})

	it("a cached tool layer survives a second restart", async () => {
		const copy = path.join(cacheDir, "tool_a.geojson")
		fs.writeFileSync(copy, JSON.stringify(POLYGON(5)))
		const toolEntry = entry({
			id: "tool_a",
			name: "flowlines",
			source: "tool",
			geojson_cache_path: copy,
			metadata_snapshot: { tool: "extract_rivers", _run_id: "run-2.1", geojson_cache_path: copy },
		})
		await persist([toolEntry])
		const first = controller()
		await hydrateMapLayersFromCatalog(first as any, project)
		expect(first.state.layers.has("tool_a")).to.equal(true)
		// The restored layer holds no content in memory; rewriting the catalog must still name its copy.
		const rewritten: MapLayerCatalog = await buildMapLayerCatalogAsync(
			[...first.state.layers.values()],
			first.state.order,
			project,
		)
		expect(rewritten.layers[0].geojson_cache_path).to.equal(copy)
		await persistMapLayerCatalog(rewritten, home)
		const second = controller()
		await hydrateMapLayersFromCatalog(second as any, project)
		expect(second.state.layers.has("tool_a")).to.equal(true)
	})
})

describe("applyAddLayer: a same-id add of another file is a new layer", () => {
	const layer = (id: string, sourcePath: string, geojson = "{}") =>
		MapLayer.create({ id, name: id, geojson, layerType: "polygon", metadata: { source_path: sourcePath } })
	const store = (): LayerStoreState => ({ layers: new Map(), order: [], aliases: new Map() })

	it("overwrites for the same file, and keeps both for two files that share an id", () => {
		const state = store()
		applyAddLayer(state, layer("user-watershed", "/w/g1/watershed.geojson", '{"a":1}'))
		applyAddLayer(state, layer("user-watershed", "/w/g1/watershed.geojson", '{"a":1}'))
		expect(state.layers.size).to.equal(1)
		const out = applyAddLayer(state, layer("user-watershed", "/w/g2/watershed.geojson", '{"a":2}'))
		expect(out.kind).to.equal("added")
		expect(state.layers.size).to.equal(2)
		expect(state.layers.get("user-watershed")?.geojson).to.equal('{"a":1}')
	})
})
