import { describe, expect, it } from "vitest"
import { approvalToneState, checkStatusToken, NEUTRAL_TOKEN } from "../approvalPresentation"
import { APPROVED_TOKEN, EVIDENCE_STATES } from "../evidenceStates"

describe("approvalPresentation", () => {
	it("maps only the approved tone to the approved (green) state", () => {
		expect(approvalToneState("approved").token).toBe(APPROVED_TOKEN)
		for (const tone of ["integrity", "pending", "untrusted", "unknown"] as const) {
			expect(approvalToneState(tone).token, tone).not.toBe(APPROVED_TOKEN)
			expect(approvalToneState(tone).id, tone).not.toBe("approved")
		}
	})

	it("keeps the neutral token off the success variable", () => {
		expect(NEUTRAL_TOKEN).not.toContain("iconPassed")
		expect(NEUTRAL_TOKEN).toBe(EVIDENCE_STATES.derived.token)
	})

	it("never gives a recorded check outcome the success token", () => {
		for (const status of ["pass", "match", "warn", "warning", "advisory", "missing", "fail", "failed", "invalid", "error", "mismatch", "other", ""]) {
			expect(checkStatusToken(status), status).not.toContain("iconPassed")
		}
		expect(checkStatusToken("pass")).toBe(NEUTRAL_TOKEN)
	})
})
