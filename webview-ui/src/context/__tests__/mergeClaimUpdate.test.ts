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

const snapshot = base({
	revision: 3,
	revisionDigest: "d1",
	historyLen: 3,
	approvalState: "approved",
	approvalForRevisionDigest: "d1",
	approvalChannel: "ssh_sig",
	approvalPrincipal: "alice",
	driftState: "in_sync",
	driftEvidenceChecked: true,
})

describe("mergeClaimUpdate", () => {
	it("returns incoming when there is no previous record", () => {
		const inc = base({ statement: "new" })
		expect(mergeClaimUpdate(undefined, inc)).toBe(inc)
	})

	it("an event with no revision never shows approved or in_sync (pending_refresh)", () => {
		const out = mergeClaimUpdate(snapshot, base({ statement: "edited" }))
		expect(out.statement).toBe("edited")
		expect(out.approvalState).toBe("pending_refresh")
		expect(out.approvalPrincipal).toBe("")
		expect(out.approvalForRevisionDigest).toBe("")
		expect(out.driftState).toBe("pending_refresh")
		expect(out.driftEvidenceChecked).toBe(false)
		// Revision group is kept as a display aid only.
		expect(out.revisionDigest).toBe("d1")
		expect(out.revision).toBe(3)
	})

	it("an event for a different revision is not carried as approved", () => {
		const out = mergeClaimUpdate(snapshot, base({ revision: 4, revisionDigest: "d2" }))
		expect(out.revisionDigest).toBe("d2")
		expect(out.revision).toBe(4)
		expect(out.approvalState).toBe("pending_refresh")
		expect(out.driftState).toBe("pending_refresh")
	})

	it("an event reporting the same revision keeps approval and drift", () => {
		const out = mergeClaimUpdate(snapshot, base({ revision: 3, revisionDigest: "d1", statement: "x" }))
		expect(out.approvalState).toBe("approved")
		expect(out.approvalForRevisionDigest).toBe("d1")
		expect(out.approvalPrincipal).toBe("alice")
		expect(out.driftState).toBe("in_sync")
		expect(out.driftEvidenceChecked).toBe(true)
	})

	it("an explicit approvalState or driftState on the event wins", () => {
		const out = mergeClaimUpdate(snapshot, base({ revisionDigest: "d2", approvalState: "none", driftState: "drifted" }))
		expect(out.approvalState).toBe("none")
		expect(out.driftState).toBe("drifted")
	})

	it("does not mutate the previous record", () => {
		mergeClaimUpdate(snapshot, base())
		expect(snapshot.approvalState).toBe("approved")
		expect(snapshot.driftState).toBe("in_sync")
	})

	it("is pending_refresh (not approved) even when nothing was reported before", () => {
		expect(mergeClaimUpdate(base(), base()).approvalState).toBe("pending_refresh")
	})
})
