import { describe, expect, it } from "vitest"
import { describeInvestigation, NO_INVESTIGATION_RECORD } from "@shared/aihydro/investigationSummary"

describe("describeInvestigation", () => {
	it("says there is no record rather than inferring one", () => {
		expect(describeInvestigation(undefined)).toBe(NO_INVESTIGATION_RECORD)
		expect(describeInvestigation(null)).toBe(NO_INVESTIGATION_RECORD)
		expect(describeInvestigation({})).toBe(NO_INVESTIGATION_RECORD)
		expect(describeInvestigation({ label: "  " })).toBe(NO_INVESTIGATION_RECORD)
	})
	it("combines the basin label with claim counts by state", () => {
		expect(
			describeInvestigation({ label: "Synthetic basin 001", claims: { approved: 1, integrityOnly: 1, notApproved: 2 } }),
		).toBe("Synthetic basin 001 · 4 claims: 1 approved, 1 integrity only, 2 not approved")
	})
	it("handles a label alone, zero claims and singular claim", () => {
		expect(describeInvestigation({ label: "SYN-1" })).toBe("SYN-1")
		expect(describeInvestigation({ label: "SYN-1", claims: { approved: 0, integrityOnly: 0, notApproved: 0 } })).toBe(
			"SYN-1 · no claims yet",
		)
		expect(describeInvestigation({ claims: { approved: 0, integrityOnly: 0, notApproved: 1 } })).toBe(
			"1 claim: 1 not approved",
		)
	})
})
