import type { TranscriptItem } from "@shared/aihydro/transcriptPresenter"
import { summarizeTurn } from "@shared/aihydro/turnSummary"
import type { AiHydroMessage } from "@shared/ExtensionMessage"
import React, { useMemo } from "react"
import type { AnswerExtras } from "@/components/chat/answer/AnswerBlock"
import BrowserSessionRow from "@/components/chat/BrowserSessionRow"
import ChatRow from "@/components/chat/ChatRow"
import { MessageHandlers } from "../chat-view/types/chatTypes"
import { RewindMenu } from "./RewindMenu"
import { WorkGroupRow } from "./WorkGroupRow"
import "./transcript.css"

export interface TranscriptRenderContext {
	/** The processed, unfiltered list (the presenter's input); call states are derived from it. */
	allMessages: AiHydroMessage[]
	modifiedMessages: AiHydroMessage[]
	expandedRows: Record<number, boolean>
	onToggleExpand: (ts: number) => void
	onHeightChange: (isTaller: boolean) => void
	onSetQuote: (quote: string | null) => void
	inputValue: string
	messageHandlers: MessageHandlers
	/** Group expansion the user chose, keyed by item key. Absent = the presenter's default. */
	groupExpanded: Record<string, boolean>
	onToggleGroup: (key: string, currentlyExpanded: boolean) => void
	/** The task is running. */
	running: boolean
}

interface TranscriptItemRendererProps {
	item: TranscriptItem
	auditMessage?: AiHydroMessage
	index: number
	count: number
	/** `ts` of the first checkpoint that follows this user turn (before the next user turn), if any. */
	rewindTs?: number
	ctx: TranscriptRenderContext
}

const isBrowserKind = (m: AiHydroMessage) =>
	m.say === "browser_action_launch" ||
	m.ask === "browser_action_launch" ||
	m.say === "browser_action" ||
	m.say === "browser_action_result"

/** Renders one presented item. Prose, asks, errors and answers keep the existing row; machinery becomes a group. */
export const TranscriptItemRenderer: React.FC<TranscriptItemRendererProps> = ({
	item,
	auditMessage,
	index,
	count,
	rewindTs,
	ctx,
}) => {
	const isLast = index === count - 1
	// The turn facts are computed once per finished answer, not on every render of the transcript.
	const answerTs = item.kind === "answer" && !item.partial ? item.ts : undefined
	const turn = useMemo(
		() => (answerTs === undefined ? undefined : summarizeTurn(ctx.allMessages, answerTs)),
		// Messages before a finished answer do not change, so the list identity is not a dependency.
		// biome-ignore lint/correctness/useExhaustiveDependencies: see above
		[answerTs],
	)
	const row = (message: AiHydroMessage, last = isLast, answer?: AnswerExtras) => (
		<ChatRow
			answer={answer}
			inputValue={ctx.inputValue}
			isExpanded={ctx.expandedRows[message.ts] || false}
			isLast={last}
			key={message.ts}
			lastModifiedMessage={ctx.modifiedMessages.at(-1)}
			message={message}
			onCancelCommand={() => ctx.messageHandlers.executeButtonAction("cancel")}
			onHeightChange={ctx.onHeightChange}
			onSetQuote={ctx.onSetQuote}
			onToggleExpand={ctx.onToggleExpand}
			sendMessageFromChatRow={ctx.messageHandlers.handleSendMessage}
		/>
	)

	switch (item.kind) {
		case "group": {
			const expanded = ctx.groupExpanded[item.key] ?? item.open
			return (
				<WorkGroupRow
					allMessages={ctx.allMessages}
					expanded={expanded}
					expandedCalls={ctx.expandedRows}
					group={item}
					live={isLast && ctx.running}
					onToggle={(key) => ctx.onToggleGroup(key, expanded)}
					onToggleCall={ctx.onToggleExpand}
					renderMessage={(m) => row(m, false)}
				/>
			)
		}
		case "user":
			return (
				<div className="transcript-turn">
					{row(item.message)}
					{rewindTs !== undefined && <RewindMenu checkpointTs={rewindTs} subject="to this message" />}
				</div>
			)
		case "answer": {
			// The audit rides in the answer card's footer. A final audit row that did not parse (or is not final) still
			// renders on its own, so nothing the gate recorded is dropped.
			const audit = item.audit
			return (
				<>
					{row(item.message, isLast, {
						audit,
						turn,
						// Dedicated reply path: never touches the draft input or quote.
						onSendFeedback: ctx.messageHandlers.sendAnswerFeedback,
					})}
					{auditMessage && !audit && row(auditMessage)}
				</>
			)
		}
		case "divider":
			// An interrupted audit reveals the held draft as unchecked (with the reason): that is the existing audit row, so
			// the draft text is never lost to a one-line divider.
			if (item.dividerKind === "answer_interrupted") {
				return row(item.message)
			}
			return (
				<div className="transcript-line transcript-divider" data-kind={item.dividerKind}>
					<i aria-hidden className="codicon codicon-info" />
					<span>{item.text}</span>
				</div>
			)
		case "passthrough":
			return item.messages.some(isBrowserKind) ? (
				<BrowserSessionRow
					expandedRows={ctx.expandedRows}
					isLast={isLast}
					lastModifiedMessage={ctx.modifiedMessages.at(-1)}
					messages={item.messages}
					onHeightChange={ctx.onHeightChange}
					onSetQuote={ctx.onSetQuote}
					onToggleExpand={ctx.onToggleExpand}
				/>
			) : (
				item.messages.map((m) => row(m))
			)
		default:
			// prose, pending, error
			return row(item.message)
	}
}
