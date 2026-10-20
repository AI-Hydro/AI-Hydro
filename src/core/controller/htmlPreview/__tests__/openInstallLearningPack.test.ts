import { expect } from "chai"
import { describe, it } from "mocha"
import { createInstallFlowGate } from "../openInstallLearningPack"

describe("openInstallLearningPack debounce", () => {
	it("runs the first call, drops calls inside the gap and while open, then runs again after the gap", async () => {
		let clock = 10_000
		let runs = 0
		const gate = createInstallFlowGate(() => clock, 2000)
		const flow = async () => {
			runs++
		}
		expect(await gate(flow)).to.equal(true)
		clock += 500
		expect(await gate(flow)).to.equal(false)
		clock += 1600
		expect(await gate(flow)).to.equal(true)
		expect(runs).to.equal(2)
	})

	it("drops a call made while the flow is still open, and recovers if the flow throws", async () => {
		let clock = 0
		const gate = createInstallFlowGate(() => clock, 100)
		let release: () => void = () => {}
		const first = gate(() => new Promise<void>((resolve) => (release = resolve)))
		clock = 1000
		expect(await gate(async () => {})).to.equal(false)
		release()
		expect(await first).to.equal(true)
		clock = 5000
		await gate(async () => {
			throw new Error("dialog failed")
		}).then(
			() => expect.fail("should propagate"),
			(error) => expect((error as Error).message).to.equal("dialog failed"),
		)
		clock = 9000
		expect(await gate(async () => {})).to.equal(true)
	})
})
