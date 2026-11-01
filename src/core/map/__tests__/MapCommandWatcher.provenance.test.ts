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
			provenance: { _run_id: "run-1", study_id: "st_1", chat_id: "chat-1", tool: "delineate_watershed", unknown: "x" },
		})
		expect(layer.metadata._run_id).to.equal("run-1")
		expect(layer.metadata.chat_id).to.equal("chat-1")
		expect(layer.metadata.tool).to.equal("delineate_watershed")
		expect(layer.metadata).to.not.have.property("run_id")
		expect(layer.metadata).to.not.have.property("unknown")
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
		const controller = { updateMapLayer: (_id: string, p: any) => (patches.push(p), true), mapSessionService: {} }
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
