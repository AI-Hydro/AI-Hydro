import { expect } from "chai"
import { describe, it } from "mocha"
import { layersForRuns, parseRunIds, showRunsOnMap } from "../showOnMap"

const layer = (id: string, run?: string): any => ({ id, name: id, metadata: run ? { _run_id: run } : {} })

function controller(layers: any[]) {
	const events: any[] = []
	return {
		events,
		c: { getMapLayers: () => layers, mapSessionService: { appendEvent: (e: any) => void events.push(e) } } as any,
	}
}

describe("show on map (host)", () => {
	it("keeps only well-formed run ids, once each, capped", () => {
		expect(parseRunIds(["run-1.2", "run-1.2", "../x", "a b", 7, "ok_2"])).to.deep.equal(["run-1.2", "ok_2"])
		expect(parseRunIds("run-1")).to.deep.equal([])
		expect(parseRunIds(Array.from({ length: 50 }, (_, i) => `r${i}`))).to.have.length(20)
	})

	it("finds layers by the run id in their own metadata, never by a layer id from the webview", () => {
		const layers = [layer("a", "run-1"), layer("b", "run-1"), layer("c", "run-2"), layer("d")]
		expect(layersForRuns(layers, ["run-1"]).map((l) => l.id)).to.deep.equal(["a", "b"])
		expect(layersForRuns(layers, ["c"])).to.deep.equal([])
	})

	it("opens the map and tells it which layers, then a user-sourced command event", async () => {
		const { c, events } = controller([layer("a", "run-1"), layer("c", "run-2")])
		let opened = 0
		const r = await showRunsOnMap(c, ["run-1"], { openMap: async () => void opened++, now: () => 42 })
		expect(r).to.deep.equal({ ok: true, layerIds: ["a"] })
		expect(opened).to.equal(1)
		expect(events).to.deep.equal([
			{
				type: "command.focus_layers",
				payloadJson: JSON.stringify({ layerIds: ["a"], runIds: ["run-1"] }),
				timestampMs: 42,
				source: "user",
			},
		])
	})

	it("does nothing, and does not open the map, when no layer carries the run", async () => {
		const { c, events } = controller([layer("a", "run-1")])
		const r = await showRunsOnMap(c, ["run-9", "../bad"], {
			openMap: async () => {
				throw new Error("must not open")
			},
			now: () => 1,
		})
		expect(r.ok).to.equal(false)
		expect(events).to.deep.equal([])
	})
})
