import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { peekUnloaded, saveUnloaded, SIDECAR_CAP, sidecarFile, takeUnloaded } from "../unloadedLayerSidecar"

let dir: string
beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "aih-sidecar-"))
})
afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true })
})

const entry = (id: string) => ({
	layer_id: id,
	name: "basin.geojson",
	layer_type: "polygon",
	style: { fillColor: "#ff0000", opacity: 0.5 },
	opacity: 0.4,
	position_from_top: 2,
	unloaded_at: 1,
})

describe("unloaded-layer sidecar", () => {
	it("lives beside the catalog, in its own file, and keeps style, opacity and place", async () => {
		await saveUnloaded("/ws", "/ws/a.geojson", entry("L1"), dir)
		expect(path.dirname(sidecarFile("/ws", dir))).to.equal(dir)
		expect(path.basename(sidecarFile("/ws", dir))).to.match(/^map_unloaded_layers\.[0-9a-f]{12}\.json$/)
		const got = await peekUnloaded("/ws", "/ws/a.geojson", dir)
		expect(got?.style).to.deep.equal({ fillColor: "#ff0000", opacity: 0.5 })
		expect(got?.opacity).to.equal(0.4)
		expect(got?.position_from_top).to.equal(2)
	})

	it("never carries a run link, tool or study, even if the caller passes one", async () => {
		await saveUnloaded("/ws", "/ws/a.geojson", { ...entry("L1"), _run_id: "r1", tool: "t", study_id: "s", claim_id: "c" } as never, dir)
		const stored = JSON.parse(await fs.readFile(sidecarFile("/ws", dir), "utf8")).layers["/ws/a.geojson"]
		expect(Object.keys(stored)).to.not.include.members(["_run_id"])
		expect(Object.keys(stored).filter((k) => /run|tool|study|claim/i.test(k))).to.deep.equal([])
	})

	it("is per project: another workspace sees nothing", async () => {
		await saveUnloaded("/ws", "/ws/a.geojson", entry("L1"), dir)
		expect(await peekUnloaded("/other", "/ws/a.geojson", dir)).to.equal(undefined)
	})

	it("take returns the entry once, then nothing", async () => {
		await saveUnloaded("/ws", "/ws/a.geojson", entry("L1"), dir)
		expect((await takeUnloaded("/ws", "/ws/a.geojson", dir))?.layer_id).to.equal("L1")
		expect(await takeUnloaded("/ws", "/ws/a.geojson", dir)).to.equal(undefined)
	})

	it("two unloads in a row both land", async () => {
		await Promise.all([
			saveUnloaded("/ws", "/ws/a.geojson", entry("A"), dir),
			saveUnloaded("/ws", "/ws/b.geojson", entry("B"), dir),
		])
		expect((await peekUnloaded("/ws", "/ws/a.geojson", dir))?.layer_id).to.equal("A")
		expect((await peekUnloaded("/ws", "/ws/b.geojson", dir))?.layer_id).to.equal("B")
	})

	it("keeps at most SIDECAR_CAP entries, dropping the oldest", async () => {
		const file = sidecarFile("/ws", dir)
		const layers: Record<string, unknown> = {}
		for (let i = 0; i < SIDECAR_CAP; i++) layers[`/ws/f${i}.geojson`] = entry(`F${i}`)
		await fs.writeFile(file, JSON.stringify({ version: 1, workspace_root: "/ws", layers }))
		await saveUnloaded("/ws", "/ws/new.geojson", entry("NEW"), dir)
		expect(await peekUnloaded("/ws", "/ws/f0.geojson", dir)).to.equal(undefined)
		expect((await peekUnloaded("/ws", "/ws/new.geojson", dir))?.layer_id).to.equal("NEW")
		expect(Object.keys(JSON.parse(await fs.readFile(file, "utf8")).layers)).to.have.length(SIDECAR_CAP)
	})
})
