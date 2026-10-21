import { extractEvidence } from "@shared/aihydro/evidenceMarkers"
import type { AnswerAuditPayload } from "@shared/aihydro/transcriptContracts"
import type { TurnSummary } from "@shared/aihydro/turnSummary"
import React, { useState } from "react"
import { useLedgerContext } from "../../../context/LedgerContext"
import { ClaimChip, claimApprovalState } from "../ClaimChip"
import { LitChip, RunChip } from "../RunChip"
import { AnswerAuditFooter, auditHasViolations } from "./AnswerAuditFooter"

/** The one fixed request "Ask agent to cite" sends. Fixed so the action is reproducible and carries no model text. */
export const ASK_TO_CITE_TEXT =
	"The answer audit found numbers or claims in your last answer that are not traced to a recorded run. Revise the answer: cite each one with [run:<id>#<path>] or [claim:<id>], or remove the value, and do not add new unsupported numbers."

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What the transcript hands a completion row: the presenter's attached audit, the turn facts, and the reply action. */
export interface AnswerExtras {
	audit?: AnswerAuditPayload
	turn?: TurnSummary
	onSendFeedback?: (text: string) => void
}

interface AnswerBlockProps {
	/** The answer text with the HAS_CHANGES flag already removed (the copy action copies exactly this). */
	text: string
	partial?: boolean
	/** The attached `final` audit, when there is one. Absent for old tasks and non-AI-Hydro tasks. */
	audit?: AnswerAuditPayload
	/** Presenter facts for the turn. Absent: no summary line. */
	turn?: TurnSummary
	hasChanges?: boolean
	seeChangesDisabled?: boolean
	onSeeChanges?: () => void
	/** Sends text as the user's reply to the answer. Absent when the answer cannot be replied to (not the last row). */
	onSendFeedback?: (text: string) => void
	/** Rating buttons (completion ask only); they live in the overflow menu. */
	feedback?: React.ReactNode
	/** The rendered answer prose (markdown with evidence markers stripped: the strip below carries them). */
	children: React.ReactNode
}

/** Evidence strip: claim chips (only `approved` is green, from evidenceStates) and run/lit references. */
const EvidenceStrip: React.FC<{ text: string }> = ({ text }) => {
	const ev = extractEvidence(text)
	if (ev.runs.length + ev.claims.length + ev.lits.length === 0) {
		return null
	}
	return (
		<div aria-label="Evidence cited in this answer" className="flex flex-wrap items-center gap-y-0.5 mt-2" role="group">
			<span className="text-xs opacity-70 mr-1">Evidence</span>
			{ev.claims.map((id) => (
				<ClaimChip claimId={id} key={`c:${id}`} />
			))}
			{ev.runs.map((r) => (
				<RunChip jsonPath={r.jsonPath} key={`r:${r.runId}#${r.jsonPath}`} runId={r.runId} />
			))}
			{ev.lits.map((t) => (
				<LitChip key={`l:${t}`} tag={t} />
			))}
		</div>
	)
}

/** "This turn": counts only. Claims are listed with their approval state so the line can never imply approval. */
const TurnLine: React.FC<{
	turn: TurnSummary
	hasChanges?: boolean
	disabled?: boolean
	onSeeChanges?: () => void
}> = ({ turn, hasChanges, disabled, onSeeChanges }) => {
	const { getClaim } = useLedgerContext()
	const parts: string[] = []
	if (turn.runIds.length > 0) {
		parts.push(plural(turn.runIds.length, "run"))
	}
	if (turn.claimIds.length > 0) {
		const approved = turn.claimIds.filter((id) => claimApprovalState(getClaim(id)).approved).length
		const state = approved === 0 ? "none approved" : `${approved} approved, ${turn.claimIds.length - approved} not approved`
		parts.push(`${plural(turn.claimIds.length, "claim")} (${state})`)
	}
	if (turn.filesChanged.length > 0) {
		parts.push(`${plural(turn.filesChanged.length, "file")} changed`)
	}
	if (parts.length === 0 && !hasChanges) {
		return null
	}
	return (
		<div className="text-xs opacity-80 mt-2" data-testid="answer-turn-summary">
			<span>This turn: {parts.length > 0 ? parts.join(" · ") : "no recorded runs or claims"}</span>
			{hasChanges && (
				<>
					{" · "}
					<button
						className="inline-flex items-center underline cursor-pointer bg-transparent border-0 p-0 text-inherit"
						disabled={disabled}
						onClick={onSeeChanges}
						style={{ cursor: disabled ? "wait" : "pointer", color: "inherit", minHeight: 24 }}
						type="button">
						<i aria-hidden="true" className="codicon codicon-new-file mr-1 align-middle" />
						See new changes
					</button>
				</>
			)}
		</div>
	)
}

const ActionButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string }> = ({
	icon,
	label,
	...rest
}) => (
	<button
		className="inline-flex items-center gap-1 min-h-6 px-1.5 text-xs cursor-pointer bg-transparent border-0 hover:underline"
		style={{ color: "var(--vscode-descriptionForeground)", minHeight: 24, minWidth: 24 }}
		type="button"
		{...rest}>
		<i aria-hidden="true" className={`codicon ${icon}`} />
		{label}
	</button>
)

/**
 * The completion answer card. Neutral by design: finishing a task is not evidence, so the header carries no status
 * colour and the body is normal foreground text. What the answer rests on is the evidence strip and the audit footer.
 */
export const AnswerBlock: React.FC<AnswerBlockProps> = ({
	text,
	partial,
	audit,
	turn,
	hasChanges,
	seeChangesDisabled,
	onSeeChanges,
	onSendFeedback,
	feedback,
	children,
}) => {
	const [menuOpen, setMenuOpen] = useState(false)
	const [copied, setCopied] = useState(false)
	const showAudit = !!audit && audit.stage === "final"
	const canCite = !partial && !!onSendFeedback && showAudit && auditHasViolations(audit)

	const copy = () => {
		try {
			void navigator.clipboard?.writeText(text)
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		} catch {
			/* clipboard unavailable: nothing to confirm */
		}
	}

	return (
		<section aria-label="Answer" className="mb-1" data-testid="answer-block" style={{ color: "var(--vscode-foreground)" }}>
			<div className="mb-2 flex items-center gap-1.5 font-bold">
				<span aria-hidden="true" className="codicon codicon-comment-discussion" />
				<span>Answer</span>
			</div>
			<div className="pt-1">{children}</div>
			{!partial && <EvidenceStrip text={text} />}
			{!partial && turn && (
				<TurnLine disabled={seeChangesDisabled} hasChanges={hasChanges} onSeeChanges={onSeeChanges} turn={turn} />
			)}
			{!partial && (
				<div className="flex flex-wrap items-center gap-x-1 mt-1.5 relative">
					<ActionButton
						icon={copied ? "codicon-check" : "codicon-copy"}
						label={copied ? "Copied" : "Copy"}
						onClick={copy}
					/>
					{canCite && (
						<ActionButton
							icon="codicon-quote"
							label="Ask agent to cite"
							onClick={() => onSendFeedback?.(ASK_TO_CITE_TEXT)}
							title="Ask the agent to cite or remove the values the audit could not trace"
						/>
					)}
					{feedback && (
						<span className="relative inline-flex">
							<button
								aria-expanded={menuOpen}
								aria-haspopup="true"
								aria-label="More answer actions"
								className="inline-flex items-center justify-center min-h-6 min-w-6 cursor-pointer bg-transparent border-0"
								onClick={() => setMenuOpen((o) => !o)}
								style={{ color: "var(--vscode-descriptionForeground)", minHeight: 24, minWidth: 24 }}
								type="button">
								<i aria-hidden="true" className="codicon codicon-ellipsis" />
							</button>
							{menuOpen && (
								<span
									className="absolute z-50 bottom-full left-0 mb-1 p-1 rounded-md shadow-lg flex items-center"
									role="group"
									style={{
										background: "var(--vscode-editorWidget-background)",
										border: "1px solid var(--vscode-panel-border)",
									}}>
									<span className="text-xs opacity-70 px-1">Rate this answer</span>
									{feedback}
								</span>
							)}
						</span>
					)}
				</div>
			)}
			{!partial && showAudit && audit && <AnswerAuditFooter audit={audit} />}
		</section>
	)
}
