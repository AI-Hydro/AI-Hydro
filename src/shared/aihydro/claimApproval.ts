/**
 * Pure display logic for claim revision / drift / approval state and for the
 * APPROVAL_REQUIRED tool refusal (vision-2040 slice 2 P4, ADR-002b A4).
 *
 * The extension is a UX client only: it renders what the backend reports and
 * never signs, holds keys, or writes approvals. Anything other than an
 * explicit `approved` state is rendered as NOT approved (fail closed).
 */

export type ApprovalTone = "approved" | "pending" | "untrusted" | "unknown"

export interface ApprovalInput {
	state?: string
	channel?: string
	trustRoot?: string
	principal?: string
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
			const parts = [channel ? channelLabel(channel) : "channel not reported", trustRoot ? `${trustRoot} trust` : ""]
			return {
				approved: true,
				tone: "approved",
				label: `Approved (${parts.filter(Boolean).join(" · ")})`,
				detail: input.principal ? `principal: ${input.principal}` : undefined,
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
		case "none":
			return { approved: false, tone: "pending", label: "Not approved", detail: input.reason }
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
				label: "In sync with sealed revision",
				tone: "ok",
				detail: input.evidenceChecked === false ? "Linked evidence was not re-checked." : undefined,
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
	approvalCommand: string
	message?: string
}

/**
 * Detect an APPROVAL_REQUIRED refusal in a tool result's text and extract the
 * backend-provided `approval_command`. Returns undefined for anything else.
 * The command is only ever shown / typed into a terminal; never executed here.
 */
export function parseApprovalRequired(resultText: string): ApprovalRequired | undefined {
	const text = resultText.replace(/^Error:\n/, "").trim()
	if (!text.includes("APPROVAL_REQUIRED")) {
		return undefined
	}
	const candidates: unknown[] = []
	try {
		candidates.push(JSON.parse(text))
	} catch {
		const start = text.indexOf("{")
		const end = text.lastIndexOf("}")
		if (start >= 0 && end > start) {
			try {
				candidates.push(JSON.parse(text.slice(start, end + 1)))
			} catch {
				// not JSON; fall through
			}
		}
	}
	for (const candidate of candidates) {
		const found = findApprovalCommand(candidate, 0)
		if (found) {
			return found
		}
	}
	return undefined
}

function findApprovalCommand(value: unknown, depth: number): ApprovalRequired | undefined {
	if (depth > 4 || !value || typeof value !== "object" || Array.isArray(value)) {
		return undefined
	}
	const obj = value as Record<string, unknown>
	if (obj.code === "APPROVAL_REQUIRED" && typeof obj.approval_command === "string" && obj.approval_command.trim()) {
		return { approvalCommand: obj.approval_command, message: typeof obj.message === "string" ? obj.message : undefined }
	}
	for (const nested of Object.values(obj)) {
		const found = findApprovalCommand(nested, depth + 1)
		if (found) {
			return found
		}
	}
	return undefined
}
