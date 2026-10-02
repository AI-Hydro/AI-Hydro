import type { ClaimRecord } from "@shared/proto/cline/ledger"
import { describe, expect, it } from "vitest"
import { mergeClaimUpdate } from "../mergeClaimUpdate"

const base = (over: Partial<ClaimRecord> = {}): ClaimRecord =>
	({
		claimId: "c1",
		sessionId: "s1",
		statement: "stmt",
		approvalState: "",
		approvalForRevisionDigest: "",
		approvalChannel: "",
		approvalTrustRoot: "",
		approvalPrincipal: "",
		approvalPolicy: "",
		approvalReason: "",
		approvalRecordedState: "",
		approvalLiveDigest: "",
		revision: 0,
		revisionDigest: "",
		historyLen: 0,
		revisionError: "",
		driftState: "",
		driftReason: "",
		driftChangedFields: [],
		driftEvidenceChecked: false,
		...over,
	}) as ClaimRecord

const approved = base({
	approvalState: "approved",
	approvalForRevisionDigest: "d1",
	approvalChannel: "cli",
	approvalPrincipal: "alice",
})

describe("mergeClaimUpdate", () => {
	it("returns incoming when there is no previous record", () => {
		const inc = base({ statement: "new" })
		expect(mergeClaimUpdate(undefined, inc)).toBe(inc)
	})

	it("keeps snapshot approval fields when the event carries none", () => {
		const out = mergeClaimUpdate(approved, base({ statement: "edited" }))
		expect(out.statement).toBe("edited")
		expect(out.approvalState).toBe("approved")
		expect(out.approvalForRevisionDigest).toBe("d1")
		expect(out.approvalChannel).toBe("cli")
		expect(out.approvalPrincipal).toBe("alice")
	})

	it("lets an event that explicitly carries approvalState win", () => {
		const out = mergeClaimUpdate(approved, base({ approvalState: "none" }))
		expect(out.approvalState).toBe("none")
		expect(out.approvalPrincipal).toBe("")
	})

	it("does not mutate the previous record", () => {
		const prev = approved
		mergeClaimUpdate(prev, base())
		expect(prev.approvalState).toBe("approved")
	})

	it("stays unreported when nothing was reported before", () => {
		expect(mergeClaimUpdate(base(), base()).approvalState).toBe("")
	})

	it("keeps the snapshot revision group when the event carries none", () => {
		const prev = base({ revision: 3, revisionDigest: "rd", historyLen: 3, revisionError: "e" })
		const out = mergeClaimUpdate(prev, base({ statement: "edited" }))
		expect(out).toMatchObject({ revision: 3, revisionDigest: "rd", historyLen: 3, revisionError: "e" })
		expect(out.statement).toBe("edited")
	})

	it("lets an explicit revisionDigest replace the whole revision group", () => {
		const prev = base({ revision: 3, revisionDigest: "rd", historyLen: 3, revisionError: "e" })
		const out = mergeClaimUpdate(prev, base({ revision: 4, revisionDigest: "rd2" }))
		expect(out).toMatchObject({ revision: 4, revisionDigest: "rd2", historyLen: 0, revisionError: "" })
	})

	it("keeps the snapshot drift group when the event carries none", () => {
		const prev = base({
			driftState: "drifted",
			driftReason: "r",
			driftChangedFields: ["statement"],
			driftEvidenceChecked: true,
		})
		const out = mergeClaimUpdate(prev, base())
		expect(out).toMatchObject({
			driftState: "drifted",
			driftReason: "r",
			driftChangedFields: ["statement"],
			driftEvidenceChecked: true,
		})
	})

	it("lets an explicit driftState win and groups are independent", () => {
		const prev = base({ driftState: "drifted", driftChangedFields: ["x"], approvalState: "approved" })
		const out = mergeClaimUpdate(prev, base({ driftState: "clean" }))
		expect(out.driftState).toBe("clean")
		expect(out.driftChangedFields).toEqual([])
		expect(out.approvalState).toBe("approved")
	})
})
