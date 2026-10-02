import type { ClaimRecord } from "@shared/proto/cline/ledger"

/**
 * Field groups that ledger events (LedgerEventWatcher) never carry: an event
 * reports them as zero values. Absence is not revocation, so when an incoming
 * record's group is unreported, the previously-known group is kept. A group is
 * "reported" when its primary field is non-empty; then the incoming group wins
 * wholesale (including its empty secondary fields).
 */
interface FieldGroup {
	primary: keyof ClaimRecord
	fields: readonly (keyof ClaimRecord)[]
}

const FIELD_GROUPS: readonly FieldGroup[] = [
	{
		primary: "revisionDigest",
		fields: ["revision", "revisionDigest", "historyLen", "revisionError"],
	},
	{
		primary: "driftState",
		fields: ["driftState", "driftReason", "driftChangedFields", "driftEvidenceChecked"],
	},
	{
		primary: "approvalState",
		fields: [
			"approvalState",
			"approvalForRevisionDigest",
			"approvalChannel",
			"approvalTrustRoot",
			"approvalPrincipal",
			"approvalPolicy",
			"approvalReason",
			"approvalRecordedState",
			"approvalLiveDigest",
		],
	},
]

/**
 * Merge a live claim update into the existing view state for that claim.
 * Each field group (revision, drift, approval) is carried over from `prev`
 * unless the incoming record explicitly reports that group's primary field.
 */
export function mergeClaimUpdate(prev: ClaimRecord | undefined, incoming: ClaimRecord): ClaimRecord {
	if (!prev) {
		return incoming
	}
	const merged: Record<string, unknown> = { ...incoming }
	for (const group of FIELD_GROUPS) {
		if (incoming[group.primary]) {
			continue
		}
		for (const field of group.fields) {
			merged[field] = prev[field]
		}
	}
	return merged as unknown as ClaimRecord
}
