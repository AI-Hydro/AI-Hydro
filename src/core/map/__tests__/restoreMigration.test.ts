import { Controller } from "@core/controller"
import { applyAddLayer, type LayerStoreState } from "@core/map/applyAddLayer"
import { MapLayer } from "@shared/proto/cline/map"
import { expect } from "chai"
import * as fs from "fs"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { hydrateMapLayersFromCatalog, restoreCatalogEntries } from "../hydrateMapLayers"
import {
	buildMapLayerCatalogAsync,
	type MapLayerCatalog,
	type MapLayerCatalogEntry,
	persistMapLayerCatalog,
	scopedMapLayerCatalogFile,
} from "../mapLayerCatalog"
import { migrateCatalogEntries } from "../restoreMigration"

/**
 * The shape of a real persisted catalog from 0.4.6: two `user-*` rows with a relative `source_path` (Reload source on a
 * restored layer), three `workspace_*` rows whose geometry was not loaded, and one of them with no workspace folder.
 * Paths here are scratch directories; nothing outside them is read or written.
 */
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

describe("restore: persisted duplicates become one layer", () => {
	let home: string
	let project: string
	let savedHome: string | undefined

	const entry = (over: Partial<MapLayerCatalogEntry> & Pick<MapLayerCatalogEntry, "id" | "name">): MapLayerCatalogEntry => ({
		layer_type: "polygon",
		visible: true,
		source: "user",
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

	let catalog: MapLayerCatalog

	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "aih-restore-home-"))
		project = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aih-restore-proj-")), "try")
		fs.mkdirSync(project, { recursive: true })
		savedHome = process.env.AIHYDRO_HOME
		process.env.AIHYDRO_HOME = home
		const cacheDir = path.join(home, "map_layer_geojson_cache")
		fs.mkdirSync(cacheDir, { recursive: true })

		// Project files: pretty-printed, so their bytes differ from the compact cache copies.
		fs.writeFileSync(path.join(project, "watershed_01013500.geojson"), JSON.stringify(POLYGON(1), null, 4))
		fs.writeFileSync(path.join(project, "watershed_01031500.geojson"), JSON.stringify(POLYGON(5), null, 4))
		fs.writeFileSync(path.join(project, "watershed_basin_24p203_75p746.geojson"), JSON.stringify(POLYGON(9), null, 4))
		// The cache copies the user-* rows were made from: the same geometry, different bytes.
		fs.writeFileSync(path.join(cacheDir, "user-watershed_01013500.geojson"), JSON.stringify(POLYGON(1)))
		fs.writeFileSync(path.join(cacheDir, "user-watershed_01031500.geojson"), JSON.stringify(POLYGON(5)))
		// An unprefixed cache file that has the project file's name and is out of date.
		fs.writeFileSync(path.join(cacheDir, "watershed_01013500.geojson"), JSON.stringify(POLYGON(77)))

		const ws = (file: string, folder = project) =>
			entry({
				id: `workspace_${file.replace(/[^a-zA-Z0-9]/g, "_")}`,
				name: file,
				source: "workspace",
				workspace_path: file,
				metadata_snapshot: { source: "workspace", path: file, ...(folder ? { workspace_folder: folder } : {}) },
			})
		const user = (stem: string, extra: Record<string, string> = {}) =>
			entry({
				id: `user-${stem}`,
				name: stem,
				geojson_cache_path: path.join(cacheDir, `user-${stem}.geojson`),
				metadata_snapshot: { source: "user", source_path: `${stem}.geojson`, source_status: "current", ...extra },
			})
		const rows = [
			ws("watershed_basin_24p203_75p746.geojson", ""),
			ws("watershed_01031500.geojson"),
			ws("watershed_01013500.geojson"),
			user("watershed_01013500"),
			{
				...user("watershed_01031500", { display_name: "Penobscot", symbology_user_override: "true" }),
				visible: true,
				style: { fillColor: "#e31a1c", strokeColor: "#800000" },
			},
		]
		catalog = { workspace_root: project, updated_at_ms: 1, layer_order: rows.map((r) => r.id), layers: rows }
	})

	// Real controllers made by a test: their queued catalog writes finish before the scratch directories go.
	const madeControllers: any[] = []
	const releasers: Array<() => void> = []

	afterEach(async () => {
		for (const release of releasers) release()
		await Promise.all(madeControllers.map((c) => c.flushMapCatalogWrites()))
		madeControllers.length = 0
		releasers.length = 0
		if (savedHome === undefined) delete process.env.AIHYDRO_HOME
		else process.env.AIHYDRO_HOME = savedHome
		fs.rmSync(home, { recursive: true, force: true })
		fs.rmSync(path.dirname(project), { recursive: true, force: true })
	})

	const fakeController = () => {
		const state: LayerStoreState = { layers: new Map(), order: [], aliases: new Map() }
		let merged = 0
		return {
			state,
			get merged() {
				return merged
			},
			setMapOverflowEntries() {},
			restorePersistedAliases(aliases: Record<string, string>) {
				for (const [a, t] of Object.entries(aliases)) state.aliases.set(a, t)
			},
			recordRestoreMerges(aliases: Record<string, string>) {
				for (const [a, t] of Object.entries(aliases)) state.aliases.set(a, t)
				merged += Object.keys(aliases).length
			},
			addMapLayer(layer: MapLayer, options: { replaceExisting?: boolean } = {}) {
				if (applyAddLayer(state, layer, options).kind !== "added") merged++
			},
		}
	}

	it("five rows become three, each holding its geometry, and none is left empty", async () => {
		await persistMapLayerCatalog(catalog, home)
		const controller = fakeController()
		await hydrateMapLayersFromCatalog(controller as any, project)
		const layers = [...controller.state.layers.values()]
		expect(layers.map((l) => l.name)).to.deep.equal([
			"watershed_basin_24p203_75p746.geojson",
			"watershed_01031500.geojson",
			"watershed_01013500.geojson",
		])
		expect(controller.merged).to.equal(2)
		for (const layer of layers) expect(layer.geojson, layer.name).to.not.equal("")
		expect(controller.state.aliases.get("user-watershed_01013500")).to.equal("workspace_watershed_01013500_geojson")
	})

	it("a layer named for a project file is the project file, not the same-named cache copy", async () => {
		await persistMapLayerCatalog(catalog, home)
		const controller = fakeController()
		await hydrateMapLayersFromCatalog(controller as any, project)
		const layer = controller.state.layers.get("workspace_watershed_01013500_geojson")
		expect(JSON.parse(layer?.geojson ?? "null")).to.deep.equal(POLYGON(1))
	})

	it("the survivor keeps what the user set on the duplicate", async () => {
		await persistMapLayerCatalog(catalog, home)
		const controller = fakeController()
		await hydrateMapLayersFromCatalog(controller as any, project)
		const layer = controller.state.layers.get("workspace_watershed_01031500_geojson")
		expect(layer?.metadata.display_name).to.equal("Penobscot")
		expect(layer?.metadata.symbology_user_override).to.equal("true")
		expect(layer?.style?.fillColor).to.equal("#e31a1c")
		// The survivor now names its file by one absolute path, so no later route can make a second layer of it.
		expect(layer?.metadata.source_path).to.equal(path.join(project, "watershed_01031500.geojson"))
	})

	it("restoring what the first restore wrote gives the same three and merges nothing", async () => {
		await persistMapLayerCatalog(catalog, home)
		const first = fakeController()
		await hydrateMapLayersFromCatalog(first as any, project)
		const written = await buildMapLayerCatalogAsync(
			[...first.state.layers.values()],
			first.state.order,
			project,
			[],
			Object.fromEntries(first.state.aliases),
		)
		await persistMapLayerCatalog(written, home)
		const second = fakeController()
		await hydrateMapLayersFromCatalog(second as any, project)
		expect(second.state.layers.size).to.equal(3)
		expect(second.merged).to.equal(0)
	})

	it("the aliases are written to the catalog and survive the next restart, with the catalog backed up once before the merge", async () => {
		await persistMapLayerCatalog(catalog, home)
		const scoped = scopedMapLayerCatalogFile(project, home)
		const original = fs.readFileSync(scoped, "utf8")
		const first = fakeController()
		await hydrateMapLayersFromCatalog(first as any, project)
		const backup = scoped.replace(/\.json$/, ".pre-merge-backup.json")
		expect(fs.readFileSync(backup, "utf8")).to.equal(original)
		const written = await buildMapLayerCatalogAsync(
			[...first.state.layers.values()],
			first.state.order,
			project,
			[],
			Object.fromEntries(first.state.aliases),
		)
		expect(written.layer_aliases).to.deep.equal({
			"user-watershed_01013500": "workspace_watershed_01013500_geojson",
			"user-watershed_01031500": "workspace_watershed_01031500_geojson",
		})
		await persistMapLayerCatalog(written, home)
		const second = fakeController()
		await hydrateMapLayersFromCatalog(second as any, project)
		expect(second.state.aliases.get("user-watershed_01013500")).to.equal("workspace_watershed_01013500_geojson")
		// The backup is the file as the older build left it: a later merge never overwrites it.
		expect(fs.readFileSync(backup, "utf8")).to.equal(original)
	})

	it("a relative path is stamped only when a file exists there", async () => {
		const missing = entry({
			id: "user-gone",
			name: "gone",
			metadata_snapshot: { source: "user", source_path: "gone.geojson" },
			geojson_cache_path: path.join(home, "map_layer_geojson_cache", "user-gone.geojson"),
		})
		const result = await migrateCatalogEntries([missing], {
			workspaceRoot: project,
			cacheDir: path.join(home, "map_layer_geojson_cache"),
		})
		expect(result.entries[0].metadata_snapshot.source_path).to.equal("gone.geojson")
		expect(result.entries[0].metadata_snapshot.workspace_folder).to.equal(undefined)
	})

	it("a style the user chose on the duplicate is kept, and key order does not stop a content match", async () => {
		const cacheDir = path.join(home, "map_layer_geojson_cache")
		fs.writeFileSync(path.join(project, "keys.geojson"), '{"type":"Polygon","coordinates":[[0,0],[1,1]]}')
		fs.writeFileSync(path.join(cacheDir, "user-keys.geojson"), '{"coordinates":[[0,0],[1,1]],"type":"Polygon"}')
		const projectRow = entry({
			id: "workspace_keys",
			name: "keys.geojson",
			source: "workspace",
			workspace_path: "keys.geojson",
			metadata_snapshot: { source: "workspace", path: "keys.geojson", workspace_folder: project },
		})
		const pathless = entry({
			id: "user-keys",
			name: "keys",
			geojson_cache_path: path.join(cacheDir, "user-keys.geojson"),
			style: { fillColor: "#ff00ff", strokeColor: "#800080" },
			metadata_snapshot: { source: "user", symbology_user_override: "true", display_name: "Mine" },
		})
		const result = await migrateCatalogEntries([projectRow, pathless], { workspaceRoot: project, cacheDir })
		expect(result.entries).to.have.length(1)
		expect(result.entries[0].style.fillColor).to.equal("#ff00ff")
		expect(result.entries[0].metadata_snapshot.display_name).to.equal("Mine")
	})

	it("a pathless layer merges with a project file only when the parsed content is identical", async () => {
		const cacheDir = path.join(home, "map_layer_geojson_cache")
		fs.writeFileSync(path.join(cacheDir, "added.geojson"), JSON.stringify(POLYGON(1)))
		fs.writeFileSync(path.join(cacheDir, "edited.geojson"), JSON.stringify(POLYGON(2)))
		const pathless = (stem: string) =>
			entry({
				id: `user-${stem}`,
				name: stem,
				geojson_cache_path: path.join(cacheDir, `${stem}.geojson`),
				metadata_snapshot: { source: "user" },
			})
		const projectLayer = entry({
			id: "workspace_x",
			name: "x.geojson",
			source: "workspace",
			workspace_path: "watershed_01013500.geojson",
			metadata_snapshot: { source: "workspace", path: "watershed_01013500.geojson", workspace_folder: project },
		})
		// Same name as a project file, but the geometry differs: kept as its own layer.
		fs.writeFileSync(path.join(project, "edited.geojson"), JSON.stringify(POLYGON(3)))
		const result = await migrateCatalogEntries([projectLayer, pathless("watershed_01013500"), pathless("edited")], {
			workspaceRoot: project,
			cacheDir,
		})
		// "watershed_01013500" has no cache copy under that id here, so it cannot be compared and stays.
		expect(result.mergedCount).to.equal(0)
		fs.writeFileSync(path.join(cacheDir, "watershed_01013500.geojson"), JSON.stringify(POLYGON(1)))
		const again = await migrateCatalogEntries(
			[
				projectLayer,
				{ ...pathless("watershed_01013500"), geojson_cache_path: path.join(cacheDir, "watershed_01013500.geojson") },
				pathless("edited"),
			],
			{ workspaceRoot: project, cacheDir },
		)
		expect(again.aliases).to.deep.equal({ "user-watershed_01013500": "workspace_x" })
		expect(again.entries.map((e) => e.id)).to.deep.equal(["workspace_x", "user-edited"])
	})

	describe("claim links (F1): a merged-away id must not orphan a bound claim", () => {
		const studyDuplicate = (extra: Record<string, string> = {}) =>
			entry({
				id: "user-watershed_01013500",
				name: "watershed_01013500",
				geojson_cache_path: path.join(home, "map_layer_geojson_cache", "user-watershed_01013500.geojson"),
				metadata_snapshot: { source: "user", source_path: "watershed_01013500.geojson", study_id: "study-1", ...extra },
			})
		const pair = () => {
			const ws = catalog.layers.find((l) => l.id === "workspace_watershed_01013500_geojson") as MapLayerCatalogEntry
			return [ws, studyDuplicate()]
		}
		const opts = (reader?: any) => ({
			workspaceRoot: project,
			cacheDir: path.join(home, "map_layer_geojson_cache"),
			linkedLayerIds: reader,
		})

		it("an id the study holds a claim link for is not merged away, and still resolves", async () => {
			const result = await migrateCatalogEntries(
				pair(),
				opts(async () => new Set(["user-watershed_01013500"])),
			)
			expect(result.aliases).to.deep.equal({})
			expect(result.entries.map((e) => e.id)).to.deep.equal([
				"workspace_watershed_01013500_geojson",
				"user-watershed_01013500",
			])
			// Through restore: the linked id is a live layer, not an alias.
			await persistMapLayerCatalog({ ...catalog, layers: [...pair()], layer_order: pair().map((e) => e.id) }, home)
			const c = fakeController()
			await hydrateMapLayersFromCatalog(c as any, project, {
				linkedLayerIds: async () => new Set(["user-watershed_01013500"]),
			})
			expect(c.state.layers.has("user-watershed_01013500")).to.equal(true)
			expect(c.state.aliases.has("user-watershed_01013500")).to.equal(false)
		})

		it("links that cannot be read leave the entry unmerged: a reader that throws, one that answers nothing, and no reader", async () => {
			for (const reader of [
				async () => {
					throw new Error("study unreadable")
				},
				async () => undefined,
				undefined,
			]) {
				const result = await migrateCatalogEntries(pair(), opts(reader))
				expect(result.mergedCount).to.equal(0)
				expect(result.entries).to.have.length(2)
			}
		})

		it("a layer that carries a claim id itself is never merged away", async () => {
			const result = await migrateCatalogEntries(
				[pair()[0], studyDuplicate({ claim_id: "claim-9" })],
				opts(async () => new Set()),
			)
			expect(result.mergedCount).to.equal(0)
		})

		it("a study that confirms no link allows the merge", async () => {
			const result = await migrateCatalogEntries(
				pair(),
				opts(async () => new Set()),
			)
			expect(result.aliases).to.deep.equal({ "user-watershed_01013500": "workspace_watershed_01013500_geojson" })
		})
	})

	describe("persistence through the real Controller (F5)", () => {
		// Layer adds queue a catalog write behind `mapHydration`; the test holds it open and releases it when restore is done,
		// as the real startup does, so the writes settle before the next controller reads the file.
		let release: () => void = () => {}
		const realController = () => {
			const c = Object.assign(Object.create(Controller.prototype), {
				mapCatalogWrites: Promise.resolve(),
				mapLayers: new Map(),
				mapLayerOrder: [],
				mapLayerAliases: new Map(),
				recentlyRemovedLayers: new Map(),
				mapOverflowEntries: [],
				mapHydration: new Promise<void>((resolve) => {
					release = resolve
					releasers.push(resolve)
				}),
				mapMergedCount: 0,
				mapHydrating: true,
				mapLayerSubscribers: new Set(),
				realPathCache: new Map(),
				currentMapScope: () => project,
			}) as any
			madeControllers.push(c)
			return c
		}

		it("the controller writes the aliases with its catalog and a fresh controller restores them without counting them as new merges", async () => {
			await persistMapLayerCatalog(catalog, home)
			const first = realController()
			await hydrateMapLayersFromCatalog(first, project)
			expect(first.getMapRestoreState().mergedCount).to.equal(2)
			release()
			await first.syncMapLayerCatalog()
			await first.flushMapCatalogWrites()
			const written = JSON.parse(fs.readFileSync(scopedMapLayerCatalogFile(project, home), "utf8"))
			expect(written.layer_aliases).to.have.property("user-watershed_01013500", "workspace_watershed_01013500_geojson")
			expect(written.layers).to.have.length(3)
			const second = realController()
			await hydrateMapLayersFromCatalog(second, project)
			expect(second.getMapLayerAliases()).to.deep.equal(first.getMapLayerAliases())
			expect(second.getMapRestoreState().mergedCount).to.equal(0)
			expect(second.resolveMapLayerId("user-watershed_01031500")).to.equal("workspace_watershed_01031500_geojson")
		})
	})

	describe("an unreadable catalog and a crash between the backup and the write (F5)", () => {
		it("an unreadable catalog restores nothing and is left byte for byte as it was", async () => {
			const file = path.join(home, "map_layer_catalog.json")
			fs.writeFileSync(file, '{"layers": [ not json')
			const c = fakeController()
			await hydrateMapLayersFromCatalog(c as any, "")
			expect(c.state.layers.size).to.equal(0)
			expect(fs.readFileSync(file, "utf8")).to.equal('{"layers": [ not json')
			expect(fs.readdirSync(home).filter((f) => f.includes("backup"))).to.deep.equal([])
		})

		it("after a crash between the backup and the write the next restore starts from the same catalog and the backup is not replaced", async () => {
			await persistMapLayerCatalog(catalog, home)
			const scoped = scopedMapLayerCatalogFile(project, home)
			const original = fs.readFileSync(scoped, "utf8")
			const first = fakeController()
			await hydrateMapLayersFromCatalog(first as any, project)
			// The process dies here: the merged catalog was never written, and a half-written temp file is left behind.
			fs.writeFileSync(`${scoped}.1234.tmp`, '{"layers": [')
			const backup = scoped.replace(/\.json$/, ".pre-merge-backup.json")
			const backupBefore = fs.readFileSync(backup, "utf8")
			const second = fakeController()
			await hydrateMapLayersFromCatalog(second as any, project)
			expect(fs.readFileSync(scoped, "utf8")).to.equal(original)
			expect(fs.readFileSync(backup, "utf8")).to.equal(backupBefore)
			expect(second.state.layers.size).to.equal(3)
			expect(second.merged).to.equal(2)
		})
	})

	describe("the restore-time duplicate check, through the real Controller.addMapLayer with realpath", () => {
		const GJ = JSON.stringify(POLYGON(3))
		const real = () => {
			const c = Object.assign(Object.create(Controller.prototype), {
				mapCatalogWrites: Promise.resolve(),
				mapLayers: new Map(),
				mapLayerOrder: [],
				mapLayerAliases: new Map(),
				recentlyRemovedLayers: new Map(),
				mapOverflowEntries: [],
				mapHydration: Promise.resolve(),
				mapMergedCount: 0,
				mapHydrating: true,
				mapLayerSubscribers: new Set(),
				realPathCache: new Map(),
				realPathOf: (p: string) => fs.realpathSync(p),
				currentMapScope: () => project,
			}) as any
			madeControllers.push(c)
			return c
		}
		const cached = (name: string) => {
			const file = path.join(home, "map_layer_geojson_cache", name)
			fs.writeFileSync(file, GJ)
			return file
		}
		const e = (id: string, over: Partial<MapLayerCatalogEntry>) => entry({ id, name: id, ...over })

		it("path-less entries with the same content: the one bound to a study is not merged into the other at restore", async () => {
			const a = e("A", { geojson_cache_path: cached("c1.dat"), metadata_snapshot: { source: "user" } })
			const b = e("B", { geojson_cache_path: cached("c2.dat"), metadata_snapshot: { source: "user", study_id: "s1" } })
			const migration = await migrateCatalogEntries([a, b], {
				workspaceRoot: project,
				cacheDir: path.join(home, "map_layer_geojson_cache"),
			})
			expect(migration.mergedCount).to.equal(0)
			const ctl = real()
			await restoreCatalogEntries(ctl, migration.entries, 2, {
				keepSeparate: migration.protectedIds,
				clearedIds: migration.clearedIds,
			})
			expect([...ctl.mapLayers.keys()]).to.deep.equal(["A", "B"])
			expect(ctl.getMapLayerAliases()).to.deep.equal({})
			expect(ctl.getMapRestoreState().mergedCount).to.equal(0)
		})

		it("layers restored later from overflow: a study and claim bound entry is not merged away", async () => {
			const p = path.join(project, "same.geojson")
			fs.writeFileSync(p, GJ)
			const a2 = e("A2", { metadata_snapshot: { source: "user", source_path: p }, geojson_cache_path: cached("a2.dat") })
			const b2 = e("B2", {
				metadata_snapshot: { source: "user", source_path: p, study_id: "s1", claim_id: "c1" },
				geojson_cache_path: cached("b2.dat"),
			})
			const ctl = real()
			ctl.mapOverflowEntries = [a2, b2]
			expect(await ctl.restoreOlderMapLayers()).to.equal(2)
			expect([...ctl.mapLayers.keys()].sort()).to.deep.equal(["A2", "B2"])
			expect(ctl.getMapLayerAliases()).to.deep.equal({})
			await ctl.flushMapCatalogWrites()
		})

		it("an entry whose id is already live is not restored over it: replaceExisting never overwrites a newer layer", async () => {
			const ctl = real()
			const newer = MapLayer.create({
				id: "A",
				name: "newer",
				geojson: GJ,
				layerType: "polygon",
				metadata: { source: "user", note: "pushed during restore" },
			})
			ctl.addMapLayer(newer)
			const old = e("A", { geojson_cache_path: cached("old.dat"), metadata_snapshot: { source: "user", study_id: "s1" } })
			const added = await restoreCatalogEntries(ctl, [old], 1)
			expect(added).to.deep.equal([])
			expect(ctl.mapLayers.get("A").name).to.equal("newer")
			expect(ctl.mapLayers.get("A").metadata.note).to.equal("pushed during restore")
		})

		it("the guard does not stop duplicates that carry no link from merging, nor an entry its study cleared", async () => {
			const p = path.join(project, "plain.geojson")
			fs.writeFileSync(p, GJ)
			const plain = (id: string) =>
				e(id, { metadata_snapshot: { source: "user", source_path: p }, geojson_cache_path: cached(`${id}.dat`) })
			const ctl = real()
			await restoreCatalogEntries(ctl, [plain("P1"), plain("P2")], 2)
			expect([...ctl.mapLayers.keys()]).to.deep.equal(["P1"])
			const linked = e("L2", {
				metadata_snapshot: { source: "user", source_path: p, study_id: "s1" },
				geojson_cache_path: cached("L2.dat"),
			})
			const ctl2 = real()
			await restoreCatalogEntries(ctl2, [plain("L1"), linked], 2, { clearedIds: new Set(["L2"]) })
			expect([...ctl2.mapLayers.keys()]).to.deep.equal(["L1"])
		})
	})
})
