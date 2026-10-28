import type { StudyCandidateView } from "@shared/ExtensionMessage"
import React, { useEffect, useRef } from "react"

export interface StudyPickerProps {
	candidates: StudyCandidateView[]
	/** The study already bound (switch mode). When set, "No study" is not offered and the picker can be kept as is. */
	currentStudyId?: string
	/** Why the picker is open: the host's reason, shown as the lead-in. */
	reason?: string
	/** False when the server cannot switch studies: the list is information only. */
	canChoose: boolean
	onChoose: (studyId: string) => void
	/** "none" = continue without a study, "new" = the next delineation creates one. Closing in switch mode = "none". */
	onDecline: (kind: "none" | "new") => void
}

/** "2026-08-02T14:03:00Z" -> "last run 2026-08-02". Anything unparseable is shown as given (the server's text). */
function lastRunText(lastRun?: string): string | undefined {
	if (!lastRun) {
		return undefined
	}
	const day = /^\d{4}-\d{2}-\d{2}/.exec(lastRun)?.[0]
	return `last run ${day ?? lastRun}`
}

const ROW_CLASS =
	"w-full text-left flex flex-col gap-0 px-2 py-1.5 min-h-[28px] rounded-sm border-0 bg-transparent text-foreground cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--vscode-focusBorder)] aria-[current=true]:bg-[var(--vscode-list-inactiveSelectionBackground)]"
const ACTION_CLASS =
	"min-h-[28px] px-2 py-1 text-xs rounded-sm border border-[var(--vscode-button-secondaryBackground)] bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] cursor-pointer hover:bg-[var(--vscode-button-secondaryHoverBackground)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--vscode-focusBorder)]"

/**
 * The studies a chat can be bound to, with the server's labels. A choice is made once and binds; nothing here
 * picks a study on the user's behalf. Reused by the Evidence Board and Replay later (F-EV6).
 */
const StudyPicker: React.FC<StudyPickerProps> = ({ candidates, currentStudyId, reason, canChoose, onChoose, onDecline }) => {
	const listRef = useRef<HTMLDivElement>(null)

	// Focus the first option when the picker opens so the keyboard can pick without a mouse.
	useEffect(() => {
		listRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus()
	}, [])

	return (
		<div
			aria-label="Choose a study for this chat"
			className="flex flex-col gap-1 rounded-sm border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] p-1.5 text-xs"
			data-testid="study-picker"
			onClick={(e) => e.stopPropagation()}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.stopPropagation()
					onDecline("none")
				}
			}}
			role="group">
			{reason && <div className="px-1 text-[var(--vscode-descriptionForeground)]">{reason}</div>}
			<div className="flex flex-col" ref={listRef}>
				{candidates.length === 0 && (
					<div className="px-2 py-1 text-[var(--vscode-descriptionForeground)]">No studies to pick from.</div>
				)}
				{candidates.map((c) => {
					const detail = [c.studyId !== c.label ? c.studyId : undefined, lastRunText(c.lastRun)]
						.filter(Boolean)
						.join(" · ")
					return (
						<button
							aria-current={c.studyId === currentStudyId}
							className={ROW_CLASS}
							disabled={!canChoose}
							key={c.studyId}
							onClick={() => onChoose(c.studyId)}
							title={`${c.label}${detail ? ` (${detail})` : ""}`}
							type="button">
							<span className="whitespace-normal break-words">{c.label}</span>
							{detail && <span className="text-[11px] text-[var(--vscode-descriptionForeground)]">{detail}</span>}
						</button>
					)
				})}
			</div>
			<div className="flex flex-wrap gap-1 pt-0.5">
				{currentStudyId ? (
					<button className={ACTION_CLASS} onClick={() => onDecline("none")} type="button">
						Keep current
					</button>
				) : (
					<>
						<button className={ACTION_CLASS} onClick={() => onDecline("new")} type="button">
							New study (delineate)
						</button>
						<button className={ACTION_CLASS} onClick={() => onDecline("none")} type="button">
							No study
						</button>
					</>
				)}
			</div>
		</div>
	)
}

export default StudyPicker
