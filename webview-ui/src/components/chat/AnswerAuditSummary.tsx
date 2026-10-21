import { droppedEvidenceLines, isAuditProgressText } from "@shared/aihydro/answerAuditGate"
import {
	type AnswerAuditPayload,
	type AnswerAuditViolation,
	MAX_AUDIT_REVISIONS,
	parseAnswerAuditPayload,
} from "@shared/aihydro/transcriptContracts"
import React, { useState } from "react"

/**
 * Interim renderer for the structured `answer_audit` say (W2-B-host). One quiet summary line with an expandable
 * list of every finding; W2-B-web replaces it with the AnswerBlock footer. Rules it keeps for the footer too:
 *  - the word "passed" appears only when the audit ran and found nothing (`status === "passed"`);
 *  - no clean/ok colour: a finding or a non-run gets the warning icon, everything else stays muted;
 *  - fix hints are shown as code, so grammar examples read as text to copy and never render as chips.
 * Gate stages (W2-C): `revision` is a counted line plus the held-back draft; `interrupted` reveals the unchecked draft;
 * a final answer after revisions states how many requests it cost, what the revision removed, and any findings left.
 */
export function auditSummaryLine(p: AnswerAuditPayload): string {
	if (p.status === "unavailable" || p.status === "skipped") {
		return `Audit not run: ${p.disclosure?.reason ?? "no reason recorded"}`
	}
	const traced = p.total !== undefined && p.cited !== undefined ? `${p.cited}/${p.total} quantities cited` : undefined
	if (p.status === "passed") {
		return traced ? `Audit passed: ${traced}` : "Audit passed"
	}
	if (p.schema === "legacy") {
		return `Audit (ungraded server): ${p.violations.length} ${p.violations.length === 1 ? "finding" : "findings"}`
	}
	return `Audit: ${[traced, `${p.hardCount} hard`, `${p.advisoryCount} advisory`].filter(Boolean).join(" · ")}`
}

const CAP = 200

/** Long text capped for display with an inline way to read the rest. */
const Capped: React.FC<{ text: string }> = ({ text }) => {
	const [open, setOpen] = useState(false)
	const flat = text.replace(/\s+/g, " ")
	if (flat.length <= CAP || open) {
		return <>{flat}</>
	}
	return (
		<>
			{flat.slice(0, CAP)}…{" "}
			<button className="underline cursor-pointer bg-transparent border-0 p-0" onClick={() => setOpen(true)} type="button">
				Show more
			</button>
		</>
	)
}

const FindingsList: React.FC<{ violations: AnswerAuditViolation[]; label: string }> = ({ violations, label }) => (
	<ol aria-label={label} className="mt-1 pl-5 list-decimal space-y-1 max-h-64 overflow-auto" tabIndex={0}>
		{violations.map((v, i) => (
			<li className="ph-no-capture" key={`${v.kind}-${i}`}>
				<code>{v.kind}</code>
				{v.severity !== "unknown" && <span> [{v.severity}]</span>}
				{v.excerpt && <span> "{v.excerpt.replace(/\s+/g, " ").slice(0, 120)}"</span>}
				{v.message && (
					<span>
						{" "}
						<Capped text={v.message} />
					</span>
				)}
				{v.fixHint && (
					<div>
						Fix:{" "}
						<code>
							<Capped text={v.fixHint} />
						</code>
					</div>
				)}
				{v.suggestedMarker && (
					<div>
						Marker: <code>{v.suggestedMarker}</code>
					</div>
				)}
			</li>
		))}
	</ol>
)

/** A held-back draft: plain text, never rendered as markdown (so a draft's markers cannot become chips here). */
const DraftText: React.FC<{ text: string; truncated?: boolean; label: string }> = ({ text, truncated, label }) => (
	<div
		aria-label={label}
		className="ph-no-capture mt-1 p-2 max-h-72 overflow-auto whitespace-pre-wrap break-words"
		role="region"
		style={{ border: "1px solid var(--vscode-widget-border, var(--vscode-panel-border))" }}
		tabIndex={0}>
		{text}
		{truncated && <div className="opacity-70 mt-1">Draft text cut at the stored limit.</div>}
	</div>
)

const Icon: React.FC<{ attention: boolean }> = ({ attention }) => (
	<span
		aria-hidden="true"
		className={`codicon ${attention ? "codicon-warning" : "codicon-info"} mr-1 align-middle`}
		style={attention ? { color: "var(--vscode-editorWarning-foreground)" } : undefined}
	/>
)

export const AnswerAuditSummary: React.FC<{ text?: string; partial?: boolean }> = ({ text, partial }) => {
	// The transient activity line shown while the gate holds the draft back.
	if (isAuditProgressText(text)) {
		return partial ? (
			<div aria-live="polite" className="text-xs opacity-80 py-0.5" data-testid="answer-audit-progress" role="status">
				<span aria-hidden="true" className="codicon codicon-loading codicon-modifier-spin mr-1 align-middle" />
				{text}
			</div>
		) : null // a progress line that outlived its run (aborted stream) carries no information
	}
	const payload = parseAnswerAuditPayload(text)
	if (!payload) {
		return (
			<div className="text-xs opacity-60 py-0.5" data-testid="answer-audit-summary">
				Audit result in an unreadable format
			</div>
		)
	}

	if (payload.stage === "pending") {
		return null // a draft persisted before its audit (so a reload can reveal it): nothing to show
	}

	if (payload.stage === "revision") {
		const hard = payload.violations.filter((v) => v.severity === "hard")
		const droppedLines = droppedEvidenceLines({
			attempt: payload.attempt,
			droppedQuantities: payload.droppedQuantities,
			droppedClaimMarkers: payload.droppedClaimMarkers,
			draftHadHard: true,
		})
		return (
			<div className="text-xs opacity-80 py-0.5" data-stage="revision" data-testid="answer-audit-summary">
				<Icon attention />
				<span className="ph-no-capture">
					Answer revised after audit (attempt {payload.attempt + 1}/{MAX_AUDIT_REVISIONS}): {hard.length} hard{" "}
					{hard.length === 1 ? "finding" : "findings"} in the draft that was held back
				</span>
				{droppedLines.map((l) => (
					<div className="ph-no-capture" key={l}>
						{l}
					</div>
				))}
				{payload.violations.length > 0 && (
					<details className="mt-1">
						<summary className="cursor-pointer select-none py-1.5">
							Show findings ({payload.violations.length})
						</summary>
						<FindingsList label="Audit findings" violations={payload.violations} />
					</details>
				)}
				{payload.draftText !== undefined && (
					<details className="mt-1">
						<summary className="cursor-pointer select-none py-1.5">Show draft ({payload.attempt + 1})</summary>
						<DraftText label="Held-back draft" text={payload.draftText} truncated={payload.draftTruncated} />
					</details>
				)}
			</div>
		)
	}

	if (payload.stage === "interrupted") {
		const reason = payload.disclosure?.reason ?? "no reason recorded"
		return (
			<div className="text-xs py-0.5" data-stage="interrupted" data-testid="answer-audit-summary">
				<Icon attention />
				<strong className="ph-no-capture">Unchecked draft (audit interrupted: {reason})</strong>
				<div className="opacity-80">
					This draft was not shown earlier and was not accepted by the audit. Treat every number in it as unverified.
				</div>
				{payload.draftText !== undefined ? (
					<DraftText label="Unchecked draft" text={payload.draftText} truncated={payload.draftTruncated} />
				) : (
					<div className="opacity-80">The draft text was not recorded.</div>
				)}
				{payload.violations.length > 0 && (
					<details className="mt-1">
						<summary className="cursor-pointer select-none py-1.5">
							Findings from the last audit pass ({payload.violations.length})
						</summary>
						<FindingsList label="Audit findings" violations={payload.violations} />
					</details>
				)}
			</div>
		)
	}

	const draftHadHard = (payload.history ?? []).some((e) => e.hardCount > 0)
	const droppedLines = droppedEvidenceLines({
		attempt: payload.attempt,
		droppedQuantities: payload.droppedQuantities,
		droppedClaimMarkers: payload.droppedClaimMarkers,
		quantitiesRemaining: payload.quantitiesRemaining,
		draftHadHard,
	})
	const attention =
		payload.status === "unavailable" ||
		payload.status === "skipped" ||
		payload.violations.length > 0 ||
		droppedLines.length > 0 ||
		payload.disclosure?.kind === "findings_remain"
	const heldDrafts = (payload.history ?? []).filter((e) => e.draftText !== undefined)
	return (
		<div className="text-xs opacity-80 py-0.5" data-status={payload.status} data-testid="answer-audit-summary">
			<Icon attention={attention} />
			<span className="ph-no-capture">{auditSummaryLine(payload)}</span>
			{payload.attempt > 0 && (
				<div className="ph-no-capture">
					Shown after {payload.attempt} silent {payload.attempt === 1 ? "revision" : "revisions"} · audit revisions:{" "}
					{payload.attempt} {payload.attempt === 1 ? "request" : "requests"}
				</div>
			)}
			{payload.disclosure?.kind === "findings_remain" && payload.disclosure.reason && (
				<div className="ph-no-capture">{payload.disclosure.reason}</div>
			)}
			{droppedLines.map((l) => (
				<div className="ph-no-capture" key={l}>
					{l}
				</div>
			))}
			{payload.violations.length > 0 && (
				<details className="mt-1">
					<summary className="cursor-pointer select-none py-1.5">Show findings ({payload.violations.length})</summary>
					<FindingsList label="Audit findings" violations={payload.violations} />
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
