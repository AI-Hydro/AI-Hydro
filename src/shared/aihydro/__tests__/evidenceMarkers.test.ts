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
})
