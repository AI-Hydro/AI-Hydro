import { droppedEvidenceLines } from "@shared/aihydro/answerAuditGate"
import type { AnswerAuditPayload } from "@shared/aihydro/transcriptContracts"
import React from "react"
import { DraftText, FindingsList, Icon, Unrevisable } from "../AnswerAuditSummary"

/**
 * The audit footer of an answer card. One quiet line by default, with every disclosure the audit made kept visible
 * even when the findings list is collapsed. It states what the audit did, never that the answer is correct:
 *  - "passed" appears only when the audit ran and found nothing (`status === "passed"`); otherwise it says
 *    "numbers traced" (n of m figures matched to a recorded run);
 *  - never coloured as a success: a finding or a non-run gets the warning icon, everything else stays muted;
 *  - held-back drafts are plain text (never markdown), so a draft's markers cannot become chips here.
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

/** True when the audit found something the agent could be asked to fix by citing: hard findings, or any legacy finding. */
export function auditHasViolations(p: AnswerAuditPayload | undefined): boolean {
	if (!p || p.status === "unavailable" || p.status === "skipped") {
		return false
	}
	return p.hardCount > 0 || (p.schema === "legacy" && p.violations.length > 0)
}

export const AnswerAuditFooter: React.FC<{ audit: AnswerAuditPayload }> = ({ audit }) => {
	const line = auditFooterLine(audit)
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
	const attention = audit.status === "unavailable" || audit.violations.length > 0 || disclosures.length > 0 || !!findingsRemain
	const unrevisable = audit.unrevisableFindings ?? []
	if (!line && audit.attempt === 0 && !findingsRemain && disclosures.length === 0 && unrevisable.length === 0) {
		return null
	}
	return (
		<div
			className="text-xs opacity-80 pt-1.5"
			data-status={audit.status}
			data-testid="answer-audit-footer"
			style={{ borderTop: "1px solid var(--vscode-widget-border, var(--vscode-panel-border))" }}>
			{line && (
				<div>
					<Icon attention={attention} />
					<span className="ph-no-capture">{line}</span>
				</div>
			)}
			{audit.attempt > 0 && (
				<div className="ph-no-capture">
					Shown after {audit.attempt} silent {audit.attempt === 1 ? "revision" : "revisions"} · audit revisions:{" "}
					{audit.attempt} {audit.attempt === 1 ? "request" : "requests"}
				</div>
			)}
			{findingsRemain && <div className="ph-no-capture">{audit.disclosure?.reason}</div>}
			{disclosures.map((l) => (
				<div className="ph-no-capture" key={l}>
					{l}
				</div>
			))}
			<Unrevisable findings={unrevisable} />
			{audit.violations.length > 0 && (
				<details className="mt-1">
					<summary className="cursor-pointer select-none py-1.5">Show findings ({audit.violations.length})</summary>
					<FindingsList label="Audit findings" violations={audit.violations} />
				</details>
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
