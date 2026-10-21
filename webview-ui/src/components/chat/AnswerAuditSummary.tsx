import { type AnswerAuditPayload, parseAnswerAuditPayload } from "@shared/aihydro/transcriptContracts"
import React, { useState } from "react"

/**
 * Interim renderer for the structured `answer_audit` say (W2-B-host). One quiet summary line with an expandable
 * list of every finding; W2-B-web replaces it with the AnswerBlock footer. Rules it keeps for the footer too:
 *  - the word "passed" appears only when the audit ran and found nothing (`status === "passed"`);
 *  - no clean/ok colour: a finding or a non-run gets the warning icon, everything else stays muted;
 *  - fix hints are shown as code, so grammar examples read as text to copy and never render as chips.
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

export const AnswerAuditSummary: React.FC<{ text?: string }> = ({ text }) => {
	const payload = parseAnswerAuditPayload(text)
	if (!payload) {
		return (
			<div className="text-xs opacity-60 py-0.5" data-testid="answer-audit-summary">
				Audit result in an unreadable format
			</div>
		)
	}
	const attention = payload.status === "unavailable" || payload.status === "skipped" || payload.violations.length > 0
	return (
		<div className="text-xs opacity-80 py-0.5" data-status={payload.status} data-testid="answer-audit-summary">
			<span
				aria-hidden="true"
				className={`codicon ${attention ? "codicon-warning" : "codicon-info"} mr-1 align-middle`}
				style={attention ? { color: "var(--vscode-editorWarning-foreground)" } : undefined}
			/>
			<span className="ph-no-capture">{auditSummaryLine(payload)}</span>
			{payload.violations.length > 0 && (
				<details className="mt-1">
					<summary className="cursor-pointer select-none">Show findings ({payload.violations.length})</summary>
					<ol
						aria-label="Audit findings"
						className="mt-1 pl-5 list-decimal space-y-1 max-h-64 overflow-auto"
						tabIndex={0}>
						{payload.violations.map((v, i) => (
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
				</details>
			)}
		</div>
	)
}
