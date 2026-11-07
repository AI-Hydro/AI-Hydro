import { expect } from "chai"
import { describe, it } from "mocha"
import { handleReplayShowOnMap } from "../replayShowOnMap"

const controller = {} as never

describe("handleReplayShowOnMap (Replay's Show on map)", () => {
	it("asks the shared handler for exactly the run ids it was sent, and says nothing when layers were shown", async () => {
		const calls: unknown[] = []
		const notes: string[] = []
		const out = await handleReplayShowOnMap(controller, ["run-1"], {
			show: async (_c, ids) => (calls.push(ids), { ok: true }),
			notify: (m) => notes.push(m),
		})
		expect(out).to.equal("shown")
		expect(calls).to.deep.equal([["run-1"]])
		expect(notes).to.deep.equal([])
	})
	it("tells the user when no layer came from the run", async () => {
		const notes: string[] = []
		const out = await handleReplayShowOnMap(controller, ["run-1"], {
			show: async () => ({ ok: false }),
			notify: (m) => notes.push(m),
		})
		expect(out).to.equal("no-layer")
		expect(notes).to.deep.equal(["No layer on the map came from that run."])
	})
	it("tells the user when the main controller is absent instead of doing nothing", async () => {
		const notes: string[] = []
		let asked = false
		const out = await handleReplayShowOnMap(undefined, ["run-1"], {
			show: async () => ((asked = true), { ok: true }),
			notify: (m) => notes.push(m),
		})
		expect(out).to.equal("no-controller")
		expect(asked).to.equal(false)
		expect(notes).to.have.length(1)
		expect(notes[0]).to.match(/not available/)
	})
})
