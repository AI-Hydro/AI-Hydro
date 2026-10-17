/**
 * Synthetic ledger claims, typed against the generated ClaimRecord so proto
 * drift fails `tsc`. Statements are invented layout text, not findings.
 */
import type { ClaimRecord } from "@shared/proto/cline/ledger"

export const FIXTURE_SESSION = "fx-session-001"
const D = (n: string) => `sha256:${n.repeat(8).slice(0, 64).padEnd(64, n)}`

export function claim(overrides: Partial<ClaimRecord> & { claimId: string }): ClaimRecord {
	return {
		sessionId: FIXTURE_SESSION,
		statement: "Synthetic claim statement for layout review.",
		status: "proposed",
		claimType: "empirical_result",
		confidence: "medium",
		createdAt: "2026-10-01T15:00:00Z",
		updatedAt: "2026-10-01T15:30:00Z",
		evidenceSpans: [],
		limitations: [],
		revision: 2,
		revisionDigest: D("a"),
		historyLen: 2,
		revisionError: "",
		driftState: "in_sync",
		driftReason: "",
		driftChangedFields: [],
		driftEvidenceChecked: true,
		approvalState: "none",
		approvalForRevisionDigest: "",
		approvalChannel: "",
		approvalTrustRoot: "",
		approvalPrincipal: "",
		approvalPolicy: "",
		approvalReason: "",
		approvalRecordedState: "",
		approvalLiveDigest: "",
		...overrides,
	}
}

const span = (sourceType: string, sourceId: string, metricRef: string, description: string) => ({
	sourceType,
	sourceId,
	metricRef,
	description,
})

export const statusClaims: ClaimRecord[] = [
	claim({
		claimId: "fx-claim-proposed",
		status: "proposed",
		statement: "Synthetic: the basin is flashy (proposed, no evidence yet).",
		confidence: "low",
	}),
	claim({
		claimId: "fx-claim-tested",
		status: "tested",
		statement: "Synthetic: the recession slope differs between two periods (under test).",
		evidenceSpans: [span("run", "fx-run-0002", "key_outputs.recession_slope", "Recorded run output")],
	}),
	claim({
		claimId: "fx-claim-weak",
		status: "weakly_supported",
		confidence: "low",
		statement: "Synthetic: baseflow share is moderate (weak support).",
		evidenceSpans: [span("run", "fx-run-0003", "key_outputs.bfi", "Single run, no interval")],
		limitations: ["Short record", "Provisional data included"],
	}),
	claim({
		claimId: "fx-claim-supported",
		status: "supported",
		confidence: "high",
		statement: "Synthetic: the signature run supports a stated baseflow index.",
		evidenceSpans: [
			span("run", "fx-run-0003", "key_outputs.bfi", "Recorded run output"),
			span("paper", "10.0000/fixture.doi", "", "Synthetic citation placeholder"),
		],
	}),
	claim({
		claimId: "fx-claim-stale",
		status: "stale",
		statement: "Synthetic: an earlier claim whose cited run changed.",
		evidenceSpans: [span("run", "fx-run-0001", "key_outputs.area", "Run record digest changed")],
		driftState: "drifted",
		driftReason: "cited evidence changed",
		driftChangedFields: ["evidence"],
	}),
	claim({
		claimId: "fx-claim-contradicted",
		status: "contradicted",
		statement: "Synthetic: modelled and observed series disagree (contradicted).",
		evidenceSpans: [span("experiment", "fx-exp-001", "metrics.nse", "Experiment cell")],
	}),
	claim({ claimId: "fx-claim-retracted", status: "retracted", statement: "Synthetic: a withdrawn claim (retracted)." }),
]

/** One claim per approval presentation, each with its own drift state. */
const base = (id: string, extra: Partial<ClaimRecord>) =>
	claim({
		claimId: id,
		status: "supported",
		confidence: "high",
		statement: `Synthetic claim for approval presentation: ${id.replace("fx-appr-", "")}.`,
		evidenceSpans: [span("run", "fx-run-0003", "key_outputs.bfi", "Recorded run output")],
		revisionDigest: D("b"),
		...extra,
	})

export const approvalClaims: Record<string, ClaimRecord> = {
	approved: base("fx-appr-approved", {
		approvalState: "approved",
		approvalForRevisionDigest: D("b"),
		approvalChannel: "ssh_sig",
		approvalTrustRoot: "system",
		approvalPolicy: "signed_required",
		approvalPrincipal: "fixture-reviewer",
		driftState: "in_sync",
	}),
	"integrity-only": base("fx-appr-integrity", {
		approvalState: "approved",
		approvalForRevisionDigest: D("b"),
		approvalChannel: "cli_same_user",
		approvalTrustRoot: "user_writable",
		approvalPolicy: "unsigned_opt_out",
		driftState: "no_history",
	}),
	consumed: base("fx-appr-consumed", {
		approvalState: "consumed",
		approvalReason: "Approval was used by a prior promotion.",
		driftState: "in_sync",
	}),
	unverifiable: base("fx-appr-unverifiable", {
		approvalState: "unverifiable",
		approvalReason: "Signature record could not be read.",
		driftState: "drifted",
		driftReason: "record unreadable",
	}),
	"stale-evidence": base("fx-appr-stale-evidence", {
		approvalState: "stale_evidence",
		driftState: "drifted",
		driftChangedFields: ["evidence"],
	}),
	"stale-revision": base("fx-appr-stale-revision", {
		approvalState: "stale_revision",
		driftState: "drifted",
		driftChangedFields: ["statement"],
	}),
	"revision-mismatch": base("fx-appr-mismatch", {
		approvalState: "approved",
		approvalForRevisionDigest: D("c"),
		approvalChannel: "ssh_sig",
		approvalTrustRoot: "system",
		driftState: "drifted",
	}),
	unreported: base("fx-appr-unreported", { approvalState: "", driftState: "" }),
}

export const driftClaims: ClaimRecord[] = [
	base("fx-drift-no-history", { driftState: "no_history", status: "tested" }),
	base("fx-drift-in-sync", { driftState: "in_sync", status: "tested" }),
	base("fx-drift-drifted", {
		driftState: "drifted",
		driftChangedFields: ["evidence", "statement"],
		driftReason: "claim and evidence changed",
		status: "tested",
	}),
]
