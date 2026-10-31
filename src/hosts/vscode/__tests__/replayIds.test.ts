import { expect } from "chai"
import { describe, it } from "mocha"
import { validReplayIds } from "../replayIds"

describe("validReplayIds (map layer Open run)", () => {
	it("accepts study and run ids of the ordinary charset", () => {
		expect(validReplayIds("study-2026.10", "run-7f3a.1")).to.deep.equal({ sessionId: "study-2026.10", runId: "run-7f3a.1" })
	})
	it("rejects a missing id, a non-string, a path or a shell character", () => {
		for (const bad of [undefined, "", 7, "../x", "a/b", "a b", "a;rm", "-lead", "x".repeat(129)]) {
			expect(validReplayIds(bad, "run-1"), `session ${String(bad)}`).to.equal(undefined)
			expect(validReplayIds("study-1", bad), `run ${String(bad)}`).to.equal(undefined)
		}
	})
})
