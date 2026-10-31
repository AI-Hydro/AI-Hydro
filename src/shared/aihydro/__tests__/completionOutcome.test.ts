import { expect } from "chai"
import { completionOutcomeOf, parseCompletionOutcome, parseUnmet } from "../completionOutcome"

describe("completion outcome (honest exit)", () => {
	it("done, absent and unrecognised values record nothing", () => {
		expect(completionOutcomeOf(undefined, undefined)).to.equal(undefined)
		expect(completionOutcomeOf("done", "- something")).to.equal(undefined)
		expect(completionOutcomeOf("", "")).to.equal(undefined)
		expect(completionOutcomeOf("mostly", "x")).to.equal(undefined)
	})

	it("partial and infeasible are recorded, case and spacing tolerated, with the unmet list", () => {
		expect(
			completionOutcomeOf(" Partial ", "- no observed streamflow for 2010-2015\n* the forcing fetch timed out\n3. no CI"),
		).to.deep.equal({
			outcome: "partial",
			unmet: ["no observed streamflow for 2010-2015", "the forcing fetch timed out", "no CI"],
		})
		expect(completionOutcomeOf("infeasible", undefined)).to.deep.equal({ outcome: "infeasible", unmet: [] })
	})

	it("caps the list and each item", () => {
		const many = Array.from({ length: 30 }, (_, i) => `item ${i}`).join("\n")
		expect(parseUnmet(many)).to.have.length(10)
		expect(parseUnmet("x".repeat(1000))[0]).to.have.length(300)
	})

	it("parses a stored record and ignores garbage", () => {
		const rec = { outcome: "partial" as const, unmet: ["a"] }
		expect(parseCompletionOutcome(JSON.stringify(rec))).to.deep.equal(rec)
		expect(parseCompletionOutcome(JSON.stringify({ outcome: "done" }))).to.equal(undefined)
		expect(parseCompletionOutcome("not json")).to.equal(undefined)
		expect(parseCompletionOutcome("")).to.equal(undefined)
	})
})
