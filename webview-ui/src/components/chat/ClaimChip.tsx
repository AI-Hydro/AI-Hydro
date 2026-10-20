import { describeApproval } from "@shared/aihydro/claimApproval"
import React, { useState } from "react"
import { useLedgerContext } from "../../context/LedgerContext"

interface ClaimChipProps {
	claimId: string
}

// Status is the evidence-grading label, NOT an approval. No status color uses the
// "passed" (green) tone: only an explicit, verified `approved` state does (see APPROVED_COLOR),
// mirroring the Evidence Board so a chat chip can never imply approval by styling alone.
const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
	supported: { bg: "bg-[var(--vscode-charts-blue)]", text: "text-white", label: "supported" },
	weakly_supported: { bg: "bg-[var(--vscode-testing-iconQueued)]", text: "text-white", label: "weak" },
	tested: { bg: "bg-[var(--vscode-textLink-foreground)]", text: "text-white", label: "tested" },
	proposed: { bg: "bg-[var(--vscode-disabledForeground)]", text: "text-white", label: "proposed" },
	contradicted: { bg: "bg-[var(--vscode-testing-iconFailed)]", text: "text-white", label: "contra" },
	stale: { bg: "bg-[var(--vscode-editorWarning-foreground)]", text: "text-white", label: "stale" },
	retracted: { bg: "bg-[var(--vscode-disabledForeground)]", text: "text-white", label: "retracted" },
}

const APPROVED_COLOR = { bg: "bg-[var(--vscode-testing-iconPassed)]", text: "text-white" }

const FALLBACK_COLOR = { bg: "bg-[var(--vscode-disabledForeground)]", text: "text-white", label: "?" }

export const ClaimChip: React.FC<ClaimChipProps> = ({ claimId }) => {
	const { getClaim } = useLedgerContext()
	const [open, setOpen] = useState(false)
	const claim = getClaim(claimId)

	const statusKey = claim?.status ?? "proposed"
	const statusColor = STATUS_COLORS[statusKey] ?? FALLBACK_COLOR
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
	const { bg, text } = approved ? APPROVED_COLOR : statusColor
	const label = statusColor.label

	return (
		<span className="relative inline-flex items-center align-middle mx-0.5">
			<button
				className={`
					inline-flex items-center gap-1 px-1.5 py-0 rounded-full text-[10px] font-medium
					leading-5 cursor-pointer border-0 ${bg} ${text}
					hover:opacity-90 transition-opacity select-none
				`}
				data-approved={approved ? "true" : "false"}
				onClick={() => setOpen((o) => !o)}
				title={claim?.statement || `Claim ${claimId}`}
				type="button">
				<span className={`codicon ${approved ? "codicon-verified-filled" : "codicon-beaker"} text-[9px]`} />
				<span>{claimId}</span>
				<span className="opacity-75">· {label}</span>
			</button>

			{open && claim && (
				<span
					className="
						absolute z-50 bottom-full left-0 mb-1 w-72 rounded-md shadow-lg
						bg-[var(--vscode-editorWidget-background)]
						border border-[var(--vscode-panel-border)]
						p-2 text-[var(--vscode-foreground)] text-xs leading-snug
					">
					<button
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
