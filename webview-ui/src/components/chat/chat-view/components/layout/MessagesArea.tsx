import { deriveCallState } from "@shared/aihydro/askOutcome"
import { isInlineApprovalAsk } from "@shared/aihydro/pendingAsk"
import type { DetailLevel } from "@shared/aihydro/transcriptPresenter"
import { AiHydroMessage } from "@shared/ExtensionMessage"
import React, { useCallback, useMemo, useRef } from "react"
import { Virtuoso } from "react-virtuoso"
import TypingIndicator from "@/components/chat/TypingIndicator"
import { updateSetting } from "@/components/settings/utils/settingsHandlers"
import { liveActivity } from "../../../transcript/ActivityLine"
import { describeCall } from "../../../transcript/ToolSummaryLine"
import { TranscriptDetailToggle } from "../../../transcript/TranscriptDetailToggle"
import { TranscriptItemRenderer, type TranscriptRenderContext } from "../../../transcript/TranscriptItemRenderer"
import { TranscriptStatus } from "../../../transcript/TranscriptStatus"
import { useGroupExpansion } from "../../../transcript/useGroupExpansion"
import { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"
import { type TranscriptView } from "../../utils/messageUtils"
import { createMessageRenderer } from "../messages/MessageRenderer"

interface MessagesAreaProps {
	task: AiHydroMessage
	groupedMessages: (AiHydroMessage | AiHydroMessage[])[]
	modifiedMessages: AiHydroMessage[]
	scrollBehavior: ScrollBehavior
	chatState: ChatState
	messageHandlers: MessageHandlers
	/** What to render: today's rows (verbose) or presenter items. */
	view: TranscriptView
	detail: DetailLevel
	isRunning: boolean
}

/** The checkpoint a "Rewind" on a user turn points at: the first one taken after it, before the next user turn. */
function rewindTargets(view: TranscriptView): Map<number, number> {
	const out = new Map<number, number>()
	view.entries.forEach((entry, i) => {
		if (entry.mode !== "presented" || entry.item.kind !== "user") {
			return
		}
		for (let j = i + 1; j < view.entries.length; j++) {
			const next = view.entries[j]
			if (next.mode !== "presented" || next.item.kind === "user") {
				break
			}
			if (next.item.kind === "group") {
				const checkpoint = next.item.members.find((m) => m.say === "checkpoint_created")
				if (checkpoint) {
					out.set(i, checkpoint.ts)
					return
				}
			}
		}
	})
	return out
}

/**
 * The scrollable messages area with virtualized list
 * Handles rendering of chat rows and browser sessions
 */
export const MessagesArea: React.FC<MessagesAreaProps> = ({
	task,
	groupedMessages,
	modifiedMessages,
	scrollBehavior,
	chatState,
	messageHandlers,
	view,
	detail,
	isRunning,
}) => {
	const {
		virtuosoRef,
		scrollContainerRef,
		toggleRowExpansion,
		handleRowHeightChange,
		setIsAtBottom,
		setShowScrollToBottom,
		disableAutoScrollRef,
		isAtBottom,
		scrollToBottomSmooth,
	} = scrollBehavior

	const { expandedRows, inputValue, setActiveQuote } = chatState
	const presented = detail !== "verbose"

	// Group expansion is the user's choice, keyed by the group's stable key, so it survives streaming appends and
	// Virtuoso unmounting the row. Absent = the presenter's default (the live tail is open at Normal).
	// It is cleared when the detail level changes (see useGroupExpansion).
	const { groupExpanded, onToggleGroup } = useGroupExpansion(detail)

	const legacyContent = useCallback(
		createMessageRenderer(
			groupedMessages,
			modifiedMessages,
			expandedRows,
			toggleRowExpansion,
			handleRowHeightChange,
			setActiveQuote,
			inputValue,
			messageHandlers,
		),
		[
			groupedMessages,
			modifiedMessages,
			expandedRows,
			toggleRowExpansion,
			handleRowHeightChange,
			setActiveQuote,
			inputValue,
			messageHandlers,
		],
	)

	const rewinds = useMemo(() => rewindTargets(view), [view])
	const ctx: TranscriptRenderContext = useMemo(
		() => ({
			allMessages: modifiedMessages,
			modifiedMessages,
			expandedRows,
			onToggleExpand: toggleRowExpansion,
			onHeightChange: handleRowHeightChange,
			onSetQuote: setActiveQuote,
			inputValue,
			messageHandlers,
			groupExpanded,
			onToggleGroup,
			running: isRunning,
		}),
		[
			modifiedMessages,
			expandedRows,
			toggleRowExpansion,
			handleRowHeightChange,
			setActiveQuote,
			inputValue,
			messageHandlers,
			groupExpanded,
			onToggleGroup,
			isRunning,
		],
	)

	const itemContent = useCallback(
		(index: number, entry: TranscriptView["entries"][number]) =>
			entry.mode === "legacy" ? (
				legacyContent(index, entry.entry)
			) : (
				<TranscriptItemRenderer
					auditMessage={entry.auditMessage}
					count={view.entries.length}
					ctx={ctx}
					index={index}
					item={entry.item}
					rewindTs={rewinds.get(index)}
				/>
			),
		[legacyContent, ctx, view.entries.length, rewinds],
	)

	// Show typing indicator when the last message is from the user (no assistant response yet)
	// Also show when an API request has started but the assistant hasn't started responding
	const showTypingIndicator = useMemo(() => {
		if (groupedMessages.length === 0) {
			return false
		}
		const last = groupedMessages[groupedMessages.length - 1]
		if (Array.isArray(last)) return false
		// User messages are type "say" with say === "user_feedback" (see
		// config.callbacks.say("user_feedback", ...) call sites) -- this
		// previously checked type === "ask" with ask === "user_feedback",
		// a combination "user_feedback" never appears under (it's an
		// AiHydroSay value, not AiHydroAsk), so the typing indicator could
		// never fire for the user's own message.
		if (last.type === "say" && last.say === "user_feedback") return true
		// API request started but no text response yet. A live work group has its own activity line instead.
		const tail = view.entries[view.entries.length - 1]
		if (presented && tail?.mode === "presented" && tail.item.kind === "group") return false
		if (last.type === "say" && last.say === "api_req_started") {
			return true
		}
		return false
	}, [groupedMessages, view, presented])

	// A pending approval is announced once per ask: the text for an ask ts is fixed the first time it is built, so a
	// state post that rebuilds this memo (same ask, same text) is not a new announcement. Presented and verbose alike.
	const approvalAnnounced = useRef<{ ts: number; text: string } | undefined>(undefined)
	const pendingApprovalText = useMemo(() => {
		const last = modifiedMessages[modifiedMessages.length - 1]
		if (!last || !isInlineApprovalAsk(last) || deriveCallState(last, modifiedMessages) !== "pending") {
			approvalAnnounced.current = undefined
			return undefined
		}
		if (approvalAnnounced.current?.ts !== last.ts) {
			const call = describeCall(last, [])
			approvalAnnounced.current = {
				ts: last.ts,
				text: `${last.subagentOrigin ? `${last.subagentOrigin.label} (read-only) is waiting for your approval` : "Waiting for your approval"}: ${call.name}${call.target ? ` ${call.target}` : ""}`,
			}
		}
		return approvalAnnounced.current.text
	}, [modifiedMessages])

	// Status for the single polite live region: short, never streamed text.
	const statusText = useMemo(() => {
		if (pendingApprovalText) {
			return pendingApprovalText
		}
		const tail = view.entries[view.entries.length - 1]
		if (!tail || tail.mode !== "presented") {
			return ""
		}
		if (tail.item.kind === "pending") {
			return "Waiting for you"
		}
		if (tail.item.kind === "answer" && !tail.item.partial && !isRunning) {
			return "Answer ready"
		}
		if (tail.item.kind === "group" && isRunning) {
			const a = liveActivity(
				tail.item.members,
				(m) => deriveCallState(m, modifiedMessages) === "running",
				(m) => describeCall(m, tail.item.kind === "group" ? tail.item.members : []).name,
			)
			return a.kind === "running" ? `Running ${a.name}` : a.kind === "thinking" ? "Thinking" : "Working"
		}
		return ""
	}, [view, isRunning, modifiedMessages, pendingApprovalText])

	return (
		<div className="overflow-hidden flex flex-col h-full relative">
			<TranscriptDetailToggle onChange={(level) => updateSetting("transcriptDetail", level)} value={detail} />
			<TranscriptStatus text={statusText} />
			<div aria-label="Conversation" aria-live="off" className="flex-grow flex" ref={scrollContainerRef} role="log">
				<Virtuoso
					atBottomStateChange={(isAtBottom) => {
						setIsAtBottom(isAtBottom)
						if (isAtBottom) {
							disableAutoScrollRef.current = false
						}
						setShowScrollToBottom(disableAutoScrollRef.current && !isAtBottom)
					}}
					atBottomThreshold={10} // trick to make sure virtuoso re-renders when task changes, and we use initialTopMostItemIndex to start at the bottom
					className="scrollable"
					components={{
						Footer: () => (
							<div>
								{showTypingIndicator && <TypingIndicator />}
								<div style={{ height: 5 }} />
							</div>
						),
					}}
					// An explicit `undefined` would replace Virtuoso's default key function, so it is only passed when presented.
					{...(presented
						? { computeItemKey: (_index: number, entry: TranscriptView["entries"][number]) => entry.key }
						: {})}
					data={view.entries}
					// increasing top by 3_000 to prevent jumping around when user collapses a row
					increaseViewportBy={{
						top: 3_000,
						bottom: Number.MAX_SAFE_INTEGER,
					}} // hack to make sure the last message is always rendered to get truly perfect scroll to bottom animation when new messages are added (Number.MAX_SAFE_INTEGER is safe for arithmetic operations, which is all virtuoso uses this value for in src/sizeRangeSystem.ts)
					initialTopMostItemIndex={view.entries.length - 1} // messages is the raw format returned by extension, modifiedMessages is the manipulated structure that combines certain messages of related type, and visibleMessages is the filtered structure that removes messages that should not be rendered
					itemContent={itemContent}
					key={`${task.ts}:${presented ? "p" : "v"}`}
					ref={virtuosoRef} // anything lower causes issues with followOutput
					style={{
						flexGrow: 1,
						overflowY: "scroll", // always show scrollbar
					}}
				/>
			</div>
		</div>
	)
}
