import { expect } from "chai"
import * as fs from "fs"
import { describe, it } from "mocha"
import * as path from "path"
import { MapCommandWatcher } from "../MapCommandWatcher"
import { mapCommandSchema } from "../mapCommandSchema"

const GEOJSON = JSON.stringify({ type: "FeatureCollection", features: [] })

function apply(command: Record<string, unknown>) {
	const added: any[] = []
	const controller = {
		addMapLayer: (l: any) => added.push(l),
		resolveMapLayerId: (id: string) => id,
		mapSessionService: { appendEvent: () => {} },
	}
	const watcher = new MapCommandWatcher(controller as any)
	const parsed = mapCommandSchema.parse(command)
	return (watcher as any).applyCommand(parsed).then(() => added)
}

describe("MapCommandWatcher add_layer_from_run provenance", () => {
	it("writes _run_id and the envelope from the command's provenance", async () => {
		const [layer] = await apply({
			type: "add_layer_from_run",
			layer_id: "l1",
			geojson: GEOJSON,
			run_id: "run-1",
			session_id: "st_1",
			provenance: {
				_run_id: "run-1",
				study_id: "st_1",
				chat_id: "chat-1",
				tool: "delineate_watershed",
				"Unknown Key": "x",
			},
		})
		expect(layer.metadata._run_id).to.equal("run-1")
		expect(layer.metadata.chat_id).to.equal("chat-1")
		expect(layer.metadata.tool).to.equal("delineate_watershed")
		expect(layer.metadata).to.not.have.property("run_id")
		expect(layer.metadata).to.not.have.property("Unknown Key")
	})

	it("copies the facts a tool states about its layer, and never lets them replace the envelope or host keys", async () => {
		const [layer] = await apply({
			type: "add_layer_from_run",
			layer_id: "l4",
			geojson: GEOJSON,
			run_id: "run-4",
			provenance: {
				_run_id: "run-4",
				study_id: "st_1",
				tool: "gauge_flowlines",
				gauge_id: "01013500",
				direction: "upstream",
				distance_km: "50",
				truncated: "false",
				n_features: "214",
				session_id: "forged",
				project_id: "forged",
				item_id: "forged",
				count_as_number: 3,
				source_path: "/etc/passwd",
				workspace_path: "/w",
				path: "/p",
				source_status: "validated",
				validation_status: "ok",
				claim_id: "c1",
				uncertainty: "none",
				raster_path: "/r.tif",
				geojson_cache_path: "/c.json",
			},
		})
		expect(layer.metadata).to.include({
			gauge_id: "01013500",
			direction: "upstream",
			distance_km: "50",
			truncated: "false",
			n_features: "214",
		})
		expect(layer.metadata.tool).to.equal("gauge_flowlines")
		expect(layer.metadata.session_id).to.equal("st_1") // the study's alias, not the forged value
		expect(layer.metadata).to.not.have.property("project_id")
		expect(layer.metadata).to.not.have.property("item_id")
		for (const refused of [
			"count_as_number",
			"source_path",
			"workspace_path",
			"path",
			"source_status",
			"validation_status",
			"claim_id",
			"uncertainty",
			"raster_path",
			"geojson_cache_path",
			"project_id",
			"item_id",
		]) {
			expect(layer.metadata, refused).to.not.have.property(refused)
		}
		expect(layer.metadata._fact_keys).to.equal("gauge_id,direction,distance_km,truncated,n_features")
	})

	it("an older tools server (no provenance object) still gets _run_id from run_id", async () => {
		const [layer] = await apply({ type: "add_layer_from_run", layer_id: "l2", geojson: GEOJSON, run_id: "run-2" })
		expect(layer.metadata._run_id).to.equal("run-2")
		expect(layer.metadata).to.not.have.property("run_id")
	})

	it("a command with no run at all yields a layer with no _run_id (the UI says no run record)", async () => {
		const [layer] = await apply({ type: "add_layer_from_run", layer_id: "l3", geojson: GEOJSON })
		expect(layer.metadata).to.not.have.property("_run_id")
	})
})

describe("update_layer cannot forge or erase provenance", () => {
	it("skips envelope, host-stamped and alias keys, and applies the rest", () => {
		const patches: any[] = []
		const controller = {
			updateMapLayer: (_id: string, p: any) => (patches.push(p), true),
			getMapLayers: () => [],
			resolveMapLayerId: (id: string) => id,
			mapSessionService: {},
		}
		const watcher = new MapCommandWatcher(controller as any)
		const cmd = mapCommandSchema.parse({
			type: "update_layer",
			layer_id: "l1",
			metadata: {
				_run_id: "forged",
				chat_id: "",
				study_id: "x",
				tool: "t",
				retrieved_at: "r",
				source: "s",
				project_id: "p",
				item_id: "i",
				session_id: "x",
				note: "kept",
			},
		})
		return (watcher as any).applyCommand(cmd).then(() => {
			expect(patches[0].metadata).to.deep.equal({ note: "kept" })
		})
	})
})

describe("update_layer cannot edit the facts a tool stated about a layer", () => {
	it("a merged-away alias of the layer is no way around it", async () => {
		const [layer] = await apply({
			type: "add_layer_from_run",
			layer_id: "canon",
			geojson: GEOJSON,
			run_id: "run-a",
			provenance: { _run_id: "run-a", tool: "gauge_flowlines", gauge_id: "01013500", n_features: "9" },
		})
		const patches: any[] = []
		const controller = {
			updateMapLayer: (_id: string, p: any) => (patches.push(p), true),
			getMapLayers: () => [layer, { id: "other", metadata: {} }],
			resolveMapLayerId: (id: string) => (id === "old-alias" ? "canon" : id),
			mapSessionService: {},
		}
		const cmd = mapCommandSchema.parse({
			type: "update_layer",
			layer_id: "old-alias",
			metadata: { gauge_id: "09999999", n_features: "1", note: "kept" },
		})
		await (new MapCommandWatcher(controller as any) as any).applyCommand(cmd)
		expect(patches[0].metadata).to.deep.equal({ note: "kept" })
	})

	it("an added layer's fact keys cannot be changed, erased or forged afterwards, and other metadata still can", async () => {
		const [layer] = await apply({
			type: "add_layer_from_run",
			layer_id: "f1",
			geojson: GEOJSON,
			run_id: "run-f",
			provenance: {
				_run_id: "run-f",
				tool: "gauge_flowlines",
				gauge_id: "01013500",
				truncated: "false",
				_fact_keys: "forged",
			},
		})
		expect(layer.metadata._fact_keys).to.equal("gauge_id,truncated") // host-stamped; a forged value is not read
		const patches: any[] = []
		const controller = {
			updateMapLayer: (_id: string, p: any) => (patches.push(p), true),
			getMapLayers: () => [layer],
			resolveMapLayerId: (id: string) => id,
			mapSessionService: {},
		}
		const cmd = mapCommandSchema.parse({
			type: "update_layer",
			layer_id: "f1",
			metadata: { gauge_id: "09999999", truncated: "true", _fact_keys: "", note: "kept" },
		})
		await (new MapCommandWatcher(controller as any) as any).applyCommand(cmd)
		expect(patches[0].metadata).to.deep.equal({ note: "kept" })
	})
})

/** Lines that spell a layer metadata key `run_id`, once the command-field reads and the schema field are removed. */
export function legacyRunIdOffenders(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.replace(/\bcmd\.run_id\b/g, "").replace(/\brun_id\??: z\./g, ""))
		.filter((line) => /(?<![_\w])run_id/.test(line))
}

describe("no legacy run_id metadata key in src/core/map", () => {
	it("the check flags the original bug line and lets command reads through", () => {
		expect(legacyRunIdOffenders('run_id: cmd.run_id || "",')).to.have.length(1)
		expect(legacyRunIdOffenders("meta.run_id")).to.have.length(1)
		expect(legacyRunIdOffenders("const r = cmd.run_id")).to.have.length(0)
		expect(legacyRunIdOffenders("run_id: z.string().optional(),")).to.have.length(0)
		expect(legacyRunIdOffenders("_run_id: z.string()")).to.have.length(0)
	})

	it("layer metadata is spelled _run_id in every source file under src/core/map", () => {
		const root = path.resolve(__dirname, "..")
		const files: string[] = []
		const walk = (dir: string) => {
			for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
				if (e.name === "__tests__") continue
				const full = path.join(dir, e.name)
				if (e.isDirectory()) walk(full)
				else if (/\.tsx?$/.test(e.name)) files.push(full)
			}
		}
		walk(root)
		expect(files.length).to.be.greaterThan(5)
		const offenders = files.flatMap((f) =>
			legacyRunIdOffenders(fs.readFileSync(f, "utf8")).map((l) => `${path.basename(f)}: ${l.trim()}`),
		)
		expect(offenders, offenders.join("\n")).to.deep.equal([])
	})
})
