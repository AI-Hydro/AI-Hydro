import type { ClaimRecord } from "@shared/proto/cline/ledger"

/**
 * Approval fields on ClaimRecord. Ledger events (LedgerEventWatcher) never
 * carry these, so an event arriving after a snapshot load reports them as "".
 * Empty means "unreported", not "revoked".
 */
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

/**
 * Merge a live claim update into the existing view state for that claim.
 * If the incoming record carries no approval fields (absence is not
 * revocation), the previously-known approval fields are kept. An incoming
 * record that explicitly reports an approvalState wins wholesale.
 */
export function mergeClaimUpdate(prev: ClaimRecord | undefined, incoming: ClaimRecord): ClaimRecord {
	if (!prev || incoming.approvalState) {
		return incoming
	}
	const merged: ClaimRecord = { ...incoming }
	for (const field of APPROVAL_FIELDS) {
		if (!incoming[field] && prev[field]) {
			merged[field] = prev[field]
		}
	}
	return merged
}
