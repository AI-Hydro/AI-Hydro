/**
 * Pure display logic for claim revision / drift / approval state and for the
 * APPROVAL_REQUIRED tool refusal (vision-2040 slice 2 P4, ADR-002b A4).
 *
 * The extension is a UX client only: it renders what the backend reports and
 * never signs, holds keys, or writes approvals. Anything other than an
 * explicit `approved` state is rendered as NOT approved (fail closed).
 */

/** Client-side approval/drift state meaning "claim changed; awaiting an authoritative snapshot". */
export const PENDING_REFRESH = "pending_refresh"

export type ApprovalTone = "approved" | "integrity" | "pending" | "untrusted" | "unknown"

export interface ApprovalInput {
	state?: string
	channel?: string
	trustRoot?: string
	principal?: string
	policy?: string
	reason?: string
	/** Digest the approval was issued for, and the claim's current revision digest. */
	forRevisionDigest?: string
	currentRevisionDigest?: string
}

export interface ApprovalDisplay {
	/** True only for an explicit `approved` state. Never inferred. */
	approved: boolean
	tone: ApprovalTone
	label: string
	detail?: string
}

const CHANNEL_LABELS: Record<string, string> = {
	cli_same_user: "same-user CLI",
	ssh_sig: "signed",
}

function channelLabel(channel: string): string {
	if (CHANNEL_LABELS[channel]) {
		return CHANNEL_LABELS[channel]
	}
	// ssh_sig variants (ssh_sig_hw, ssh_sig_v1, ...) are all signature-verified channels.
	return channel.startsWith("ssh_sig") ? "signed" : channel
}

export function describeApproval(input: ApprovalInput): ApprovalDisplay {
	const state = (input.state ?? "").trim()
	switch (state) {
		case "approved": {
			const forDigest = (input.forRevisionDigest ?? "").trim()
			const currentDigest = (input.currentRevisionDigest ?? "").trim()
			if (forDigest && currentDigest && forDigest !== currentDigest) {
				// Fail closed: an approval for another revision is not an approval of this one.
				return {
					approved: false,
					tone: "untrusted",
					label: "Approval is for a different revision",
					detail: "The claim changed after it was approved; re-approve the current revision.",
				}
			}
			const channel = (input.channel ?? "").trim()
			const trustRoot = (input.trustRoot ?? "").trim()
			const policy = (input.policy ?? "").trim()
			const parts = [channel ? channelLabel(channel) : "channel not reported", trustRoot ? `${trustRoot} trust` : ""]
			const how = parts.filter(Boolean).join(" · ")
			// Human-verified styling only for a system or supplied trust root, never an opt-out
			// policy or same-user channel (ADR-002: user_writable trust is integrity-only).
			const verified =
				(trustRoot === "system" || trustRoot === "supplied") &&
				policy !== "unsigned_opt_out" &&
				channel !== "cli_same_user"
			if (!verified) {
				return {
					approved: false,
					tone: "integrity",
					label: "Accepted (integrity only)",
					detail: [how, policy ? `policy: ${policy}` : "", input.principal ? `principal: ${input.principal}` : ""]
						.filter(Boolean)
						.join(" · "),
				}
			}
			return {
				approved: true,
				tone: "approved",
				label: `Approved (${how})`,
				detail:
					[policy ? `policy: ${policy}` : "", input.principal ? `principal: ${input.principal}` : ""]
						.filter(Boolean)
						.join(" · ") || undefined,
			}
		}
		case "consumed":
			return {
				approved: false,
				tone: "pending",
				label: "Approval already used",
				detail: input.reason || "A new approval is required for further promotion.",
			}
		case "unverifiable":
			return {
				approved: false,
				tone: "untrusted",
				label: "Approval unverifiable",
				detail: input.reason || "The approval record could not be verified; treated as not approved.",
			}
		case "stale_evidence":
			return {
				approved: false,
				tone: "untrusted",
				label: "Approval stale: cited evidence changed",
				detail: input.reason || "The evidence this claim cites changed after it was approved; re-approve.",
			}
		case "stale_revision":
			return {
				approved: false,
				tone: "untrusted",
				label: "Approval stale: claim edited after approval",
				detail: input.reason || "Claim fields were edited after approval; re-approve the current revision.",
			}
		case "evidence_unchecked":
			return {
				approved: false,
				tone: "unknown",
				label: "Approval unchecked: evidence cannot be verified",
				detail: input.reason || "Some cited evidence cannot be checked read-only; treated as not approved.",
			}
		case "none":
			return { approved: false, tone: "pending", label: "Not approved", detail: input.reason }
		case PENDING_REFRESH:
			// Client-side sentinel: a live event proved the claim changed but carries no approval.
			// Neither approved nor revoked; the next snapshot is authoritative.
			return {
				approved: false,
				tone: "pending",
				label: "Approval pending refresh",
				detail: "The claim changed; approval state is being re-read from the ledger.",
			}
		default:
			return {
				approved: false,
				tone: "unknown",
				label: "Approval state not reported",
				detail: "Backend did not report an approval state; treated as not approved.",
			}
	}
}

export interface DriftInput {
	state?: string
	reason?: string
	changedFields?: string[]
	evidenceChecked?: boolean
}

export interface DriftDisplay {
	label: string
	tone: "ok" | "warn" | "unknown"
	detail?: string
}

export function describeDrift(input: DriftInput): DriftDisplay {
	switch ((input.state ?? "").trim()) {
		case "in_sync":
			return {
				label:
					input.evidenceChecked === false
						? "In sync (fields only; evidence not re-checked)"
						: "In sync with sealed revision",
				tone: input.evidenceChecked === false ? "unknown" : "ok",
			}
		case "drifted": {
			const fields = (input.changedFields ?? []).filter(Boolean)
			return {
				label: "Drifted since sealed revision",
				tone: "warn",
				detail:
					[fields.length ? `changed: ${fields.join(", ")}` : "", input.reason ?? ""].filter(Boolean).join(" — ") ||
					undefined,
			}
		}
		case "evidence_unchecked":
			return {
				label: "Fields in sync; some evidence cannot be checked",
				tone: "unknown",
				detail: input.reason,
			}
		case PENDING_REFRESH:
			return { label: "Drift pending refresh", tone: "unknown", detail: "The claim changed; drift is being re-read." }
		case "no_history":
			return { label: "No sealed revision yet", tone: "unknown", detail: input.reason }
		default:
			return { label: "Drift not reported", tone: "unknown", detail: input.reason }
	}
}

export interface MinimalRunLike {
	minimal?: boolean
}

/** Split run rows into the default-visible set and the hidden minimal ("recorded call") rows. */
export function partitionMinimalRuns<T extends MinimalRunLike>(
	entries: T[],
	showMinimal: boolean,
): { visible: T[]; minimalCount: number } {
	const minimalCount = entries.filter((entry) => entry.minimal === true).length
	return { visible: showMinimal ? entries : entries.filter((entry) => entry.minimal !== true), minimalCount }
}

export interface ApprovalRequired {
	sessionId: string
	claimId: string
	/** Built client-side from validated ids; never copied from the tool result. */
	approvalCommand: string
}

export type ApprovalRequiredResult = { ok: true; approval: ApprovalRequired } | { ok: false; message: string }

export const APPROVAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/**
 * Detect an APPROVAL_REQUIRED refusal. Only the TOP-LEVEL envelope of a result
 * from the ai-hydro server is considered (no nested search): tool results can
 * echo agent- or document-supplied data, so a nested refusal is untrusted.
 * `approval_command` is never used; the command is rebuilt from `session_id`
 * and `claim_id` after charset validation. Returns undefined when the result
 * is not a refusal envelope.
 */
export function parseApprovalRequired(resultText: string, serverName: string): ApprovalRequiredResult | undefined {
	if (serverName !== "ai-hydro") {
		return undefined
	}
	let value: unknown
	try {
		value = JSON.parse(resultText.replace(/^Error:\n/, "").trim())
	} catch {
		return undefined
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined
	}
	const envelope = value as Record<string, unknown>
	if (envelope.code !== "APPROVAL_REQUIRED") {
		return undefined
	}
	const sessionId = envelope.session_id
	const claimId = envelope.claim_id
	if (
		typeof sessionId !== "string" ||
		typeof claimId !== "string" ||
		!APPROVAL_ID_PATTERN.test(sessionId) ||
		!APPROVAL_ID_PATTERN.test(claimId)
	) {
		return {
			ok: false,
			message:
				"Approval is required, but the session or claim id is missing or has unexpected characters, so no terminal command was pre-filled. Run aihydro-approve yourself after checking the ids.",
		}
	}
	return { ok: true, approval: { sessionId, claimId, approvalCommand: `aihydro-approve ${sessionId} ${claimId}` } }
}
