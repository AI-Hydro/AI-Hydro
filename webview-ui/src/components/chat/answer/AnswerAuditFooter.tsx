import { droppedEvidenceLines } from "@shared/aihydro/answerAuditGate"
import { type AnswerAuditPayload, GATE_SKIP_TEXT, isCleanAudit } from "@shared/aihydro/transcriptContracts"
import React, { useId, useState } from "react"
import { DraftText, FindingsList, Icon, Unrevisable } from "../AnswerAuditSummary"
import { auditSummaryView } from "./auditFindings"
import { useTranscriptDetail } from "./useTranscriptDetail"

/**
 * The audit footer of an answer card. One quiet line a reader can act on ("3 numbers aren't linked to a recorded
 * run · Review"), collapsed, with every disclosure the audit made kept visible even then. It states what the audit
 * did, never that the answer is correct:
 *  - "All n numbers traced" / "Audit passed" appear only when the audit ran and found nothing (`status === "passed"`);
 *  - never coloured as a success: a finding or a non-run gets the warning icon, everything else stays muted;
 *  - the expanded list is human-readable; the auditor's repair instructions and raw markers show only at Verbose;
 *  - held-back drafts are plain text (never markdown), so a draft's markers cannot become chips here.
 * `auditFooterLine` is the technical form of the same line (Verbose, tests).
 */
export function auditFooterLine(p: AnswerAuditPayload): string | undefined {
	if (p.status === "skipped") {
		return undefined
	}
	if (p.status === "unavailable") {
		return `Audit not run: ${p.disclosure?.reason ?? "no reason recorded"}`
	}
	const traced = p.total !== undefined && p.cited !== undefined ? `${p.cited}/${p.total} numbers traced` : undefined
	if (p.status === "passed") {
		return traced ? `Audit passed: ${traced}` : "Audit passed"
	}
	if (p.schema === "legacy") {
		return `Audit (ungraded server): ${p.violations.length} ${p.violations.length === 1 ? "finding" : "findings"}`
	}
	return `Audit: ${[traced, `${p.hardCount} hard`, `${p.advisoryCount} advisory`].filter(Boolean).join(" · ")}`
}

/**
 * The line saying the revise-before-showing gate did not run, with its reason. Settings and Plan mode are the user's
 * own choices and show at Verbose only; every other reason means a safeguard could not engage, so it always shows.
 */
export function gateSkippedLine(p: AnswerAuditPayload, verbose: boolean): string | undefined {
	const skip = p.gateSkipped ? GATE_SKIP_TEXT[p.gateSkipped] : undefined
	if (!skip || (skip.chosen && !verbose)) {
		return undefined
	}
	return `Answer was not held back for checking: ${skip.text}.`
}

/** True when the audit found something the agent could be asked to fix by citing: hard findings, or any legacy finding. */
export function auditHasViolations(p: AnswerAuditPayload | undefined): boolean {
	if (!p || p.status === "unavailable" || p.status === "skipped") {
		return false
	}
	return p.hardCount > 0 || (p.schema === "legacy" && p.violations.length > 0)
}

interface FooterProps {
	audit: AnswerAuditPayload
	/** Sends the follow-up that asks the agent to link the untraced numbers. Absent: the answer cannot be replied to. */
	onAskToLink?: () => void
	askSent?: boolean
}

const MUTED_BUTTON = "inline-flex items-center gap-1 cursor-pointer bg-transparent border-0 p-0 text-xs text-left"

export const AnswerAuditFooter: React.FC<FooterProps> = ({ audit, onAskToLink, askSent }) => {
	const detail = useTranscriptDetail()
	const verbose = detail === "verbose"
	const [open, setOpen] = useState(false)
	const bodyId = useId()
	const summary = auditSummaryView(audit)
	const draftHadHard = (audit.history ?? []).some((e) => e.hardCount > 0)
	const disclosures = droppedEvidenceLines({
		attempt: audit.attempt,
		droppedQuantities: audit.droppedQuantities,
		droppedClaimMarkers: audit.droppedClaimMarkers,
		quantitiesRemaining: audit.quantitiesRemaining,
		draftHadHard,
	})
	const findingsRemain = audit.disclosure?.kind === "findings_remain" && audit.disclosure.reason
	const heldDrafts = (audit.history ?? []).filter((e) => e.draftText !== undefined)
	const unrevisable = audit.unrevisableFindings ?? []
	const notRun = audit.status === "unavailable" ? auditFooterLine(audit) : undefined
	const skippedGate = gateSkippedLine(audit, verbose)
	const clean = isCleanAudit(audit)
	const cleanLine =
		clean && detail !== "focus"
			? audit.total !== undefined && audit.total > 0
				? `All ${audit.total} ${audit.total === 1 ? "number" : "numbers"} traced`
				: "Audit passed"
			: undefined
	if (
		!summary &&
		!notRun &&
		!cleanLine &&
		audit.attempt === 0 &&
		!findingsRemain &&
		!skippedGate &&
		disclosures.length === 0 &&
		unrevisable.length === 0
	) {
		return null
	}
	const canAsk = !!onAskToLink && auditHasViolations(audit)
	return (
		<div
			className="text-xs opacity-90 pt-1.5"
			data-status={audit.status}
			data-testid="answer-audit-footer"
			style={{ borderTop: "1px solid var(--vscode-widget-border, var(--vscode-panel-border))" }}>
			{summary && (
				<div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
					<button
						aria-controls={bodyId}
						aria-expanded={open}
						className={MUTED_BUTTON}
						data-tone={summary.tone}
						onClick={() => setOpen((o) => !o)}
						style={{ color: "var(--vscode-foreground)", minHeight: 24 }}
						type="button">
						<Icon attention={summary.tone === "warn"} />
						<span className="ph-no-capture">{summary.text}</span>
						<span aria-hidden="true">·</span>
						<span className="underline">{open ? "Hide" : "Review"}</span>
						<i aria-hidden="true" className={`codicon ${open ? "codicon-chevron-up" : "codicon-chevron-down"}`} />
					</button>
					{canAsk && (
						<button
							className={`${MUTED_BUTTON} underline`}
							disabled={askSent}
							onClick={onAskToLink}
							style={{ color: "var(--vscode-textLink-foreground)", minHeight: 24 }}
							title="Sends a follow-up asking AI-Hydro to cite each of these numbers with a recorded run, or remove it"
							type="button">
							{askSent ? "Asked AI-Hydro to link these" : "Ask AI-Hydro to link these"}
						</button>
					)}
				</div>
			)}
			{cleanLine && (
				<div className="opacity-80">
					<span aria-hidden="true" className="codicon codicon-check mr-1 align-middle" />
					<span className="ph-no-capture">{cleanLine}</span>
				</div>
			)}
			{notRun && (
				<div>
					<Icon attention />
					<span className="ph-no-capture">{notRun}</span>
				</div>
			)}
			{audit.attempt > 0 && (
				<div className="ph-no-capture opacity-80">
					Shown after {audit.attempt} silent {audit.attempt === 1 ? "revision" : "revisions"} · audit revisions:{" "}
					{audit.attempt} {audit.attempt === 1 ? "request" : "requests"}
				</div>
			)}
			{skippedGate && (
				<div className="opacity-80" data-testid="answer-audit-gate-skipped">
					<Icon attention={!(audit.gateSkipped && GATE_SKIP_TEXT[audit.gateSkipped].chosen)} />
					<span className="ph-no-capture">{skippedGate}</span>
				</div>
			)}
			{findingsRemain && <div className="ph-no-capture opacity-80">{audit.disclosure?.reason}</div>}
			{disclosures.map((l) => (
				<div className="ph-no-capture opacity-80" key={l}>
					{l}
				</div>
			))}
			<Unrevisable findings={unrevisable} />
			{summary && open && (
				<div id={bodyId}>
					<p className="mt-1 mb-0 opacity-80">
						Numbers in an answer should trace to a recorded run so each can be checked.
						{audit.total !== undefined && audit.cited !== undefined && audit.total > 0
							? ` ${audit.cited} of ${audit.total} are traced.`
							: ""}
					</p>
					<FindingsList label="Numbers to review" violations={audit.violations} />
					{verbose && <div className="mt-1 opacity-70 ph-no-capture">{auditFooterLine(audit)}</div>}
				</div>
			)}
			{heldDrafts.length > 0 && (
				<details className="mt-1">
					<summary className="cursor-pointer select-none py-1.5">Show draft ({heldDrafts.length})</summary>
					{heldDrafts.map((e) => (
						<DraftText
							key={e.attempt}
							label={`Held-back draft ${e.attempt + 1}`}
							text={e.draftText as string}
							truncated={e.draftTruncated}
						/>
					))}
				</details>
			)}
		</div>
	)
}
