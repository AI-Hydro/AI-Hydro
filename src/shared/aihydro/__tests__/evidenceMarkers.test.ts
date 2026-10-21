import { expect } from "chai"
import { AIHYDRO_MARKER_SOURCE, extractEvidence, markerChipProperties, markerFromMatch } from "../evidenceMarkers"

describe("evidenceMarkers", () => {
	it("extracts distinct run, claim and lit markers in first-seen order", () => {
		const e = extractEvidence("a [run:r1#x.y] b [claim:c1] [claim:c1] [lit:abc] [run:r1#x.y] [run:r2#z]")
		expect(e.runs).to.deep.equal([
			{ runId: "r1", jsonPath: "x.y" },
			{ runId: "r2", jsonPath: "z" },
		])
		expect(e.claims).to.deep.equal(["c1"])
		expect(e.lits).to.deep.equal(["abc"])
	})

	it("ignores grammar placeholders that do not start alphanumeric", () => {
		const e = extractEvidence("[lit:...] [lit:<tag>] [claim:] [run:#x] [run:<id>#<path>]")
		expect(e).to.deep.equal({ runs: [], claims: [], lits: [] })
	})

	it("chip properties match the markdown pipeline contract", () => {
		const m = new RegExp(AIHYDRO_MARKER_SOURCE).exec("[claim:c-1]")!
		expect(markerChipProperties(markerFromMatch(m)!)).to.deep.equal({ "data-chip-type": "claim", "data-claim-id": "c-1" })
	})

	describe("code is not a citation", () => {
		it("skips fenced code (backtick and tilde, unterminated included)", () => {
			expect(extractEvidence("```\n[run:a#b] [claim:c1]\n```\n[claim:c2]").claims).to.deep.equal(["c2"])
			expect(extractEvidence("~~~md\n[claim:c1]\n~~~\n").claims).to.deep.equal([])
			expect(extractEvidence("text\n```\n[claim:c1]\nnever closed").claims).to.deep.equal([])
		})
		it("skips markers inside longer inline code but counts a whole-value inline code marker", () => {
			expect(extractEvidence("Cite as `Fix: add [run:abc#nse] to it`").runs).to.deep.equal([])
			expect(extractEvidence("see `[claim:c1]` and ``[claim:c2]``").claims).to.deep.equal(["c1", "c2"])
			expect(extractEvidence("`x [claim:c3] y`").claims).to.deep.equal([])
		})
	})
})
