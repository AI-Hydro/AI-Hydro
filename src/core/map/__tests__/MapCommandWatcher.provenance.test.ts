import { expect } from "chai"
import * as fs from "fs"
import { describe, it } from "mocha"
import * as path from "path"
import { MapCommandWatcher } from "../MapCommandWatcher"
import { mapCommandSchema } from "../mapCommandSchema"

const GEOJSON = JSON.stringify({ type: "FeatureCollection", features: [] })

function apply(command: Record<string, unknown>) {
	const added: any[] = []
	const controller = { addMapLayer: (l: any) => added.push(l), mapSessionService: { appendEvent: () => {} } }
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

describe("no legacy run_id metadata key in src/core/map", () => {
	it("only the command field (cmd.run_id / schema) spells run_id; layer metadata uses _run_id", () => {
		const dir = path.resolve(__dirname, "..")
		const offenders: string[] = []
		for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
			fs.readFileSync(path.join(dir, file), "utf8")
				.split("\n")
				.forEach((line, i) => {
					if (/(?<![_\w])run_id/.test(line) && !/cmd\.run_id|run_id: z\./.test(line)) {
						offenders.push(`${file}:${i + 1}: ${line.trim()}`)
					}
				})
		}
		expect(offenders, offenders.join("\n")).to.deep.equal([])
	})
})
