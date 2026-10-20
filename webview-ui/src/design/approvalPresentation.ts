/**
 * Maps the pure approval/drift display tones (`@shared/aihydro/claimApproval`) onto the shared
 * evidence-state tokens, so the Evidence Board and Replay never choose a colour of their own.
 *
 * Two axes stay separate:
 *  - scientific status (what the agent or package says about the claim/run) is never green;
 *  - approval authority is green only for the `approved` tone, which `describeApproval` returns
 *    only for a human-verified stamp.
 */
import type { ApprovalTone } from "@shared/aihydro/claimApproval"
import { type EvidenceStateDef, type EvidenceStateId, evidenceState } from "./evidenceStates"

const APPROVAL_TONE_STATE: Record<ApprovalTone, EvidenceStateId> = {
	approved: "approved",
	integrity: "integrity-only",
	pending: "unverified",
	untrusted: "refused",
	unknown: "unverified",
}

export function approvalToneState(tone: ApprovalTone): EvidenceStateDef {
	return evidenceState(APPROVAL_TONE_STATE[tone])
}

/** Neutral token for informational facts that carry no approval authority ("in sync", "0 need review"). */
export const NEUTRAL_TOKEN: string = evidenceState("derived").token

/** Token for a recorded-check outcome. A validator `pass` is package-recorded, never approval, so it is neutral. */
export function checkStatusToken(status: string): string {
	switch (status) {
		case "pass":
		case "match":
			return NEUTRAL_TOKEN
		case "warn":
		case "warning":
		case "advisory":
		case "missing":
			return "var(--vscode-testing-iconQueued)"
		case "fail":
		case "failed":
		case "invalid":
		case "error":
		case "mismatch":
			return "var(--vscode-testing-iconFailed)"
		default:
			return evidenceState("unverified").token
	}
}
