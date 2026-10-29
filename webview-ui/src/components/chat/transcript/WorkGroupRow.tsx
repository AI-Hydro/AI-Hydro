import { deriveCallState } from "@shared/aihydro/askOutcome"
import type { LiftedLine, WorkGroup } from "@shared/aihydro/transcriptPresenter"
import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { type ReactNode, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ActivityLine, liveActivity } from "./ActivityLine"
import { RewindMenu } from "./RewindMenu"
import { summarizeGroup } from "./summary"
import { describeCall, isCallMessage, ToolSummaryLine } from "./ToolSummaryLine"

const TONE: Record<LiftedLine["tone"], { icon: string; label: string }> = {
	error: { icon: "codicon-error", label: "Error" },
	warning: { icon: "codicon-warning", label: "Warning" },
	notice: { icon: "codicon-info", label: "Notice" },
}

interface WorkGroupRowProps {
	group: WorkGroup
	/** Effective expansion (the user's choice, else the presenter's default for the live tail). */
	expanded: boolean
	onToggle: (key: string) => void
	/** True while this group is the tail of a running task. */
	live: boolean
	/** The raw stream, for call states. */
	allMessages: readonly AiHydroMessage[]
	/** Expansion state of the inner call lines, keyed by the call's `ts`. */
	expandedCalls: Record<number, boolean>
	onToggleCall: (ts: number) => void
	/** The existing full row for a call, shown when its line is expanded. */
	renderMessage: (message: AiHydroMessage) => ReactNode
}

/**
 * A work group: one header button, the lines the reader must not miss (real text, visible while collapsed), the live
 * activity line, and, when expanded, one line per call. Nothing here depends on colour alone: every lifted line
 * carries a codicon and a visually hidden tone word.
 */
export function WorkGroupRow({
	group,
	expanded,
	onToggle,
	live,
	allMessages,
	expandedCalls,
	onToggleCall,
	renderMessage,
}: WorkGroupRowProps) {
	const panelId = useId()
	const rootRef = useRef<HTMLDivElement>(null)
	const headerRef = useRef<HTMLButtonElement>(null)
	const wasExpanded = useRef(expanded)

	// When an open group collapses (the live tail closing at turn end), keep keyboard focus: move it to the header.
	// Whether focus was inside has to be read during render, before React removes the collapsed lines from the DOM
	// (removing the focused element drops focus to <body> before any effect could look).
	const focusWasInside = useRef(false)
	if (wasExpanded.current && !expanded) {
		const active = document.activeElement
		focusWasInside.current = !!active && active !== headerRef.current && !!rootRef.current?.contains(active)
	}
	useLayoutEffect(() => {
		if (focusWasInside.current) {
			headerRef.current?.focus()
			focusWasInside.current = false
		}
		wasExpanded.current = expanded
	}, [expanded])

	const summary = useMemo(
		() => summarizeGroup(group.facts, group.lifted, live, group.absorbed),
		[group.facts, group.lifted, group.absorbed, live],
	)
	const calls = useMemo(() => group.members.filter(isCallMessage), [group.members])
	// "Rewind this work" points at the checkpoint taken when the work began (the first one in the group).
	const checkpoint = group.members.find((m) => m.say === "checkpoint_created")
	const rewindTs = checkpoint?.ts ?? group.rewindTs
	const activity = useMemo(
		() =>
			live
				? liveActivity(
						group.members,
						(m) => deriveCallState(m, allMessages) === "running",
						(m) => describeCall(m, group.members).name,
					)
				: undefined,
		[live, group.members, allMessages],
	)

	return (
		<div className="transcript-group" data-expanded={expanded} data-testid="work-group" ref={rootRef}>
			<div className="transcript-group-head">
				<button
					aria-controls={panelId}
					aria-expanded={expanded}
					aria-label={summary.label}
					className="transcript-btn transcript-btn-line transcript-group-toggle"
					onClick={() => onToggle(group.key)}
					ref={headerRef}
					type="button">
					<i aria-hidden className={`codicon ${expanded ? "codicon-chevron-down" : "codicon-chevron-right"}`} />
					<span>{summary.text}</span>
				</button>
				{rewindTs !== undefined && (
					<RewindMenu checkpointTs={rewindTs} isCheckedOut={checkpoint?.isCheckpointCheckedOut} subject="this work" />
				)}
			</div>
			{group.lifted.length > 0 && (
				<ul className="transcript-lifted">
					{group.lifted.map((line) => (
						<LiftedLineItem key={line.key} line={line} />
					))}
				</ul>
			)}
			{activity && <ActivityLine activity={activity} />}
			<div hidden={!expanded} id={panelId}>
				{expanded && (
					<>
						{group.absorbed.length > 0 && (
							<ul className="transcript-lifted" data-testid="absorbed-lifts">
								{group.absorbed.map((line) => (
									<LiftedLineItem key={line.key} line={line} />
								))}
							</ul>
						)}
						<ul className="transcript-calls">
							{calls.length === 0 && <li className="transcript-line">No tool calls in this stretch.</li>}
							{calls.map((m) => (
								<ToolSummaryLine
									allMessages={allMessages}
									expanded={!!expandedCalls[m.ts]}
									key={`${m.type}:${m.ts}`}
									members={group.members}
									message={m}
									onToggle={() => onToggleCall(m.ts)}
									panelId={`${panelId}-call-${m.ts}`}>
									{renderMessage(m)}
								</ToolSummaryLine>
							))}
						</ul>
					</>
				)}
			</div>
		</div>
	)
}

/**
 * One lifted line. An aggregated line (`count > 1`) carries a disclosure listing every member, so the shortened list
 * never hides a call: the full per-call list is one click away.
 */
function LiftedLineItem({ line }: { line: LiftedLine }) {
	const [open, setOpen] = useState(false)
	const listId = useId()
	const aggregated = line.count > 1
	return (
		<li
			className={`transcript-line transcript-lifted-line${line.reason === "checkpoint_checked_out" ? " transcript-banner" : ""}`}
			data-count={line.count}
			data-reason={line.reason}
			data-tone={line.tone}>
			<i aria-hidden className={`codicon ${TONE[line.tone].icon}`} />
			<span className="transcript-sr-only">{TONE[line.tone].label}: </span>
			{aggregated ? (
				<>
					<button
						aria-controls={listId}
						aria-expanded={open}
						className="transcript-btn transcript-btn-line"
						data-testid="lifted-disclosure"
						onClick={() => setOpen((v) => !v)}
						type="button">
						<i aria-hidden className={`codicon ${open ? "codicon-chevron-down" : "codicon-chevron-right"}`} />
						<span>{line.text}</span>
					</button>
					{open && (
						<ul className="transcript-lifted-members" id={listId}>
							{line.members.map((m) => (
								<li className="transcript-line" key={m.sourceTs}>
									{m.text}
								</li>
							))}
						</ul>
					)}
				</>
			) : (
				<span>{line.text}</span>
			)}
		</li>
	)
}
