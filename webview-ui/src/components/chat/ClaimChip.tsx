import { describeApproval } from "@shared/aihydro/claimApproval"
import type { ClaimRecord } from "@shared/proto/cline/ledger"
import React, { useState } from "react"
import { useLedgerContext } from "../../context/LedgerContext"
import { type EvidenceStateId, evidenceState } from "../../design"

interface ClaimChipProps {
	claimId: string
	/**
	 * `strip` (default): the 24px chip. `inline`: a compact chip for use inside prose. The visible chip is small so
	 * the line rhythm holds; the button around it is 24px tall with negative vertical margins, so the hit area still
	 * meets the target size without growing the line.
	 */
	variant?: "strip" | "inline"
}

// Status is the evidence-grading label, NOT an approval. The chip's colour, icon and border come from the shared
// evidence-state table (design/evidenceStates.ts), where only `approved` is green. A chat chip can therefore never
// imply approval by styling alone.
const STATUS_LABELS: Record<string, string> = {
	supported: "supported",
	weakly_supported: "weak",
	tested: "tested",
	proposed: "proposed",
	contradicted: "contra",
	stale: "stale",
	retracted: "retracted",
}

/** Map a claim's status and approval display to the evidence state that styles its chip. */
function chipState(statusKey: string, approved: boolean, tone: string | undefined): EvidenceStateId {
	if (approved) {
		return "approved"
	}
	if (statusKey === "stale" || statusKey === "retracted") {
		return "stale"
	}
	if (statusKey === "contradicted") {
		return "refused"
	}
	if (tone === "integrity") {
		return "integrity-only"
	}
	if (statusKey === "proposed") {
		return "agent-asserted"
	}
	return "unverified"
}

/** The approval display of a ledger claim and whether it earns the approved styling (explicit, verified, not stale/contradicted). */
export function claimApprovalState(claim: ClaimRecord | undefined) {
	const statusKey = claim?.status ?? "proposed"
	const approval = claim
		? describeApproval({
				state: claim.approvalState,
				channel: claim.approvalChannel,
				trustRoot: claim.approvalTrustRoot,
				principal: claim.approvalPrincipal,
				policy: claim.approvalPolicy,
				reason: claim.approvalReason,
				forRevisionDigest: claim.approvalForRevisionDigest,
				currentRevisionDigest: claim.revisionDigest,
			})
		: undefined
	// Only an explicit, verified approval gets the approved styling; everything else keeps its status color.
	// A contradicted claim never shows green: the contradiction must stay visible even if it was once approved.
	const approved =
		approval?.approved === true && statusKey !== "stale" && statusKey !== "retracted" && statusKey !== "contradicted"
	return { statusKey, approval, approved }
}

/** Hit area of an inline chip: 24px square minimum, pulled back into the line with negative vertical margins. */
export const INLINE_HIT_STYLE: React.CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	minHeight: 24,
	minWidth: 24,
	margin: "-5px 1px",
	padding: "0 1px",
	background: "transparent",
	border: 0,
	color: "inherit",
	cursor: "pointer",
	verticalAlign: "middle",
}
/** The visible compact chip inside an inline hit area. */
export const INLINE_CHIP_STYLE: React.CSSProperties = { minHeight: 16, lineHeight: "14px", padding: "0 4px" }

export const ClaimChip: React.FC<ClaimChipProps> = ({ claimId, variant = "strip" }) => {
	const { getClaim } = useLedgerContext()
	const [open, setOpen] = useState(false)
	const claim = getClaim(claimId)

	const { statusKey, approval, approved } = claimApprovalState(claim)
	const def = evidenceState(chipState(statusKey, approved, approval?.tone))
	const label = approved ? "approved" : (STATUS_LABELS[statusKey] ?? "?")

	return (
		<span className="relative inline-flex items-center align-middle mx-0.5">
			{variant === "inline" ? (
				<button
					data-approved={approved ? "true" : "false"}
					data-evidence-state={def.id}
					data-variant="inline"
					onClick={() => setOpen((o) => !o)}
					style={
						{
							"--aih-badge-color": def.token,
							...INLINE_HIT_STYLE,
						} as React.CSSProperties
					}
					title={claim?.statement || `Claim ${claimId}`}
					type="button">
					<span className={`aih-badge aih-badge--${def.shape}`} style={INLINE_CHIP_STYLE}>
						<span aria-hidden="true" className={`codicon ${def.icon}`} />
						<span>{claimId}</span>
						<span className="opacity-75">· {label}</span>
					</span>
				</button>
			) : (
				<button
					className={`
					aih-badge aih-badge--${def.shape} min-h-6 cursor-pointer
					hover:opacity-90 transition-opacity select-none
				`}
					data-approved={approved ? "true" : "false"}
					data-evidence-state={def.id}
					onClick={() => setOpen((o) => !o)}
					style={{ "--aih-badge-color": def.token, minHeight: 24 } as React.CSSProperties}
					title={claim?.statement || `Claim ${claimId}`}
					type="button">
					<span aria-hidden="true" className={`codicon ${def.icon}`} />
					<span>{claimId}</span>
					<span className="opacity-75">· {label}</span>
				</button>
			)}

			{open && claim && (
				<span
					className="
						absolute z-50 bottom-full left-0 mb-1 w-72 rounded-md shadow-lg
						bg-[var(--vscode-editorWidget-background)]
						border border-[var(--vscode-panel-border)]
						p-2 text-[var(--vscode-foreground)] text-xs leading-snug
					">
					<button
						aria-label="Close claim details"
						className="absolute top-1 right-1 codicon codicon-close opacity-60 hover:opacity-100 bg-transparent border-0 cursor-pointer"
						onClick={() => setOpen(false)}
						type="button"
					/>
					<p className="font-semibold mb-1">{claimId}</p>
					<p className="mb-1 italic opacity-80">{claim.statement}</p>
					{approval && (
						<p className="mb-0.5" data-approved={approval.approved ? "true" : "false"} data-testid="chip-approval">
							<span className="opacity-60">Approval: </span>
							{approval.label}
						</p>
					)}
					<p className="mb-0.5 opacity-70" data-testid="chip-approval-note">
						Does not approve claims. Claim approval is a signed step you perform in a terminal (aihydro-approve).
					</p>
					{claim.confidence && (
						<p className="mb-0.5">
							<span className="opacity-60">Confidence: </span>
							{claim.confidence}
						</p>
					)}
					{claim.evidenceSpans.length > 0 && (
						<div className="mt-1">
							<p className="opacity-60 mb-0.5">Evidence:</p>
							{claim.evidenceSpans.map((e, i) => (
								<p className="pl-1 opacity-80 text-[10px] font-mono truncate" key={i}>
									{e.sourceType}:{e.sourceId}
									{e.metricRef && <span className="opacity-60"> #{e.metricRef}</span>}
								</p>
							))}
						</div>
					)}
					{claim.limitations.length > 0 && (
						<div className="mt-1">
							<p className="opacity-60 mb-0.5">Limitations:</p>
							{claim.limitations.map((l, i) => (
								<p className="pl-1 opacity-80 text-[10px]" key={i}>
									• {l}
								</p>
							))}
						</div>
					)}
				</span>
			)}
		</span>
	)
}
