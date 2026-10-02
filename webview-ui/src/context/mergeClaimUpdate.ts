import { PENDING_REFRESH } from "@shared/aihydro/claimApproval"
import type { ClaimRecord } from "@shared/proto/cline/ledger"

/**
 * A ledger event is a write notification, not a state report: it proves the
 * claim changed and says nothing about approval or drift. Those come only from
 * a snapshot. The merge therefore never shows a verified state it cannot tie
 * to the same revision:
 *
 *  - revision group (primary `revisionDigest`): replaced when the event reports
 *    a digest, otherwise carried over as a display aid only.
 *  - approval / drift groups: carried over ONLY when the event reports a
 *    `revisionDigest` equal to the previous one (the revision did not move).
 *    Otherwise the group becomes an explicit `pending_refresh` state: not
 *    approved, not revoked, awaiting the next snapshot.
 *  - an event that explicitly reports a group's primary field wins for it.
 *  - a `promoted` event (an approval was just consumed) never carries approval
 *    forward, even if it reports the unchanged digest: promotion is outside the
 *    revision digest, so only a snapshot can say what the approval became.
 */
const REVISION_FIELDS = ["revision", "revisionDigest", "historyLen", "revisionError"] as const

const APPROVAL_FIELDS = [
	"approvalState",
	"approvalForRevisionDigest",
	"approvalChannel",
	"approvalTrustRoot",
	"approvalPrincipal",
	"approvalPolicy",
	"approvalReason",
	"approvalRecordedState",
	"approvalLiveDigest",
] as const satisfies readonly (keyof ClaimRecord)[]

const DRIFT_FIELDS = ["driftState", "driftReason", "driftChangedFields", "driftEvidenceChecked"] as const

/** Change types that invalidate approval/drift without moving the revision digest. */
const APPROVAL_INVALIDATING_CHANGES = new Set(["promoted"])

export function mergeClaimUpdate(prev: ClaimRecord | undefined, incoming: ClaimRecord, changeType = ""): ClaimRecord {
	if (!prev) {
		return incoming
	}
	const merged: Record<string, unknown> = { ...incoming }
	const reportedDigest = incoming.revisionDigest || ""
	if (!reportedDigest) {
		for (const field of REVISION_FIELDS) {
			merged[field] = prev[field]
		}
	}
	const sameRevision =
		reportedDigest !== "" && reportedDigest === (prev.revisionDigest || "") && !APPROVAL_INVALIDATING_CHANGES.has(changeType)

	if (!incoming.approvalState) {
		for (const field of APPROVAL_FIELDS) {
			merged[field] = sameRevision ? prev[field] : ""
		}
		if (!sameRevision) {
			merged.approvalState = PENDING_REFRESH
		}
	}
	if (!incoming.driftState) {
		if (sameRevision) {
			for (const field of DRIFT_FIELDS) {
				merged[field] = prev[field]
			}
		} else {
			merged.driftState = PENDING_REFRESH
			merged.driftReason = ""
			merged.driftChangedFields = []
			merged.driftEvidenceChecked = false
		}
	}
	return merged as unknown as ClaimRecord
}
