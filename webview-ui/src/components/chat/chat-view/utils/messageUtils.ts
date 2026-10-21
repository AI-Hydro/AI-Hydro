/**
 * Utility functions for message filtering, grouping, and manipulation
 */

import { getPairing } from "@shared/aihydro/toolCallPresenter"
import { parseAnswerAuditPayload } from "@shared/aihydro/transcriptContracts"
import { type PresentOptions, presentTranscript, type TranscriptItem } from "@shared/aihydro/transcriptPresenter"
import { combineApiRequests } from "@shared/combineApiRequests"
import { combineCommandSequences } from "@shared/combineCommandSequences"
import { AiHydroMessage, AiHydroSayBrowserAction } from "@shared/ExtensionMessage"

/**
 * Combine API requests and command sequences in messages
 */
export function processMessages(messages: AiHydroMessage[]): AiHydroMessage[] {
	return combineApiRequests(combineCommandSequences(messages))
}

/**
 * Filter messages that should be visible in the chat
 */
export function filterVisibleMessages(messages: AiHydroMessage[]): AiHydroMessage[] {
	return messages.filter((message, index) => {
		switch (message.ask) {
			case "completion_result":
				// don't show a chat row for a completion_result ask without text. This specific type of message only occurs if AI-Hydro wants to execute a command as part of its completion result, in which case we interject the completion_result tool with the execute_command tool.
				if (message.text === "") {
					return false
				}
				break
			case "api_req_failed": // this message is used to update the latest api_req_started that the request failed
			case "resume_task":
			case "resume_completed_task":
				return false
		}
		switch (message.say) {
			case "api_req_finished": // combineApiRequests removes this from modifiedMessages anyways
			case "api_req_retried": // this message is used to update the latest api_req_started that the request was retried
			case "deleted_api_reqs": // aggregated api_req metrics from deleted messages
			case "task_progress": // task progress messages are displayed in TaskHeader, not in main chat
				return false
			case "text":
				// Sometimes AI-Hydro returns an empty text message, we don't want to render these. (We also use a say text for user messages, so in case they just sent images we still render that)
				if ((message.text ?? "") === "" && (message.images?.length ?? 0) === 0) {
					return false
				}
				break
			case "mcp_server_request_started":
				return false
			case "mcp_server_response":
				// A first-party science call shows its result inside the tool-call card, not as a raw JSON row.
				if (getPairing(messages).hiddenResponses.has(index)) {
					return false
				}
				break
		}
		return true
	})
}

/**
 * Check if a message is part of a browser session
 */
export function isBrowserSessionMessage(message: AiHydroMessage): boolean {
	if (message.type === "ask") {
		return ["browser_action_launch"].includes(message.ask!)
	}
	if (message.type === "say") {
		return [
			"browser_action_launch",
			"api_req_started",
			"text",
			"browser_action",
			"browser_action_result",
			"checkpoint_created",
			"reasoning",
		].includes(message.say!)
	}
	return false
}

/**
 * Group messages, combining browser session messages into arrays
 */
export function groupMessages(visibleMessages: AiHydroMessage[]): (AiHydroMessage | AiHydroMessage[])[] {
	const result: (AiHydroMessage | AiHydroMessage[])[] = []
	let currentGroup: AiHydroMessage[] = []
	let isInBrowserSession = false

	const endBrowserSession = () => {
		if (currentGroup.length > 0) {
			result.push([...currentGroup])
			currentGroup = []
			isInBrowserSession = false
		}
	}

	visibleMessages.forEach((message) => {
		if (message.ask === "browser_action_launch" || message.say === "browser_action_launch") {
			// complete existing browser session if any
			endBrowserSession()
			// start new
			isInBrowserSession = true
			currentGroup.push(message)
		} else if (isInBrowserSession) {
			// end session if api_req_started is cancelled
			if (message.say === "api_req_started") {
				// get last api_req_started in currentGroup to check if it's cancelled
				const lastApiReqStarted = [...currentGroup].reverse().find((m) => m.say === "api_req_started")
				if (lastApiReqStarted?.text != null) {
					const info = JSON.parse(lastApiReqStarted.text)
					const isCancelled = info.cancelReason != null
					if (isCancelled) {
						endBrowserSession()
						result.push(message)
						return
					}
				}
			}

			if (isBrowserSessionMessage(message)) {
				currentGroup.push(message)

				// Check if this is a close action
				if (message.say === "browser_action") {
					const browserAction = JSON.parse(message.text || "{}") as AiHydroSayBrowserAction
					if (browserAction.action === "close") {
						endBrowserSession()
					}
				}
			} else {
				// complete existing browser session if any
				endBrowserSession()
				result.push(message)
			}
		} else {
			result.push(message)
		}
	})

	// Handle case where browser session is the last group
	if (currentGroup.length > 0) {
		result.push([...currentGroup])
	}

	return result
}

/**
 * Get the task message from the messages array
 */
export function getTaskMessage(messages: AiHydroMessage[]): AiHydroMessage | undefined {
	return messages.at(0)
}

// ── Transcript presenter wiring (Wave 2, W2-A2) ─────────────────────────────────────────────────────────────────

/** One Virtuoso row. `legacy` rows are exactly today's ChatRow / BrowserSessionRow output (verbose detail). */
export type RenderEntry =
	| { mode: "legacy"; key: string; entry: AiHydroMessage | AiHydroMessage[] }
	| { mode: "presented"; key: string; item: TranscriptItem; auditMessage?: AiHydroMessage }

export interface TranscriptView {
	entries: RenderEntry[]
	/** One entry per row, in the shape useScrollBehavior understands (a message, or the messages a row covers). */
	scrollEntries: (AiHydroMessage | AiHydroMessage[])[]
}

/**
 * Builds what the list renders. `verbose` is today's pipeline untouched (filter + browser-session grouping); every
 * other level runs the presenter on the UNFILTERED processed list, so nothing the filter drops is lost to it.
 */
export function buildTranscriptView(
	processed: AiHydroMessage[],
	grouped: (AiHydroMessage | AiHydroMessage[])[],
	options: PresentOptions,
): TranscriptView {
	if (options.detail === "verbose") {
		return {
			entries: grouped.map((entry, i) => ({
				mode: "legacy" as const,
				key: Array.isArray(entry) ? `legacy:${entry[0]?.ts}:${i}` : `legacy:${entry.ts}:${i}`,
				entry,
			})),
			scrollEntries: grouped,
		}
	}
	const items = presentTranscript(processed, options)
	const entries: RenderEntry[] = items.map((item) => ({
		mode: "presented" as const,
		key: item.key,
		item,
		auditMessage:
			item.kind === "answer" && item.audit
				? processed.find(
						(m) => m.say === "answer_audit" && m.text && parseAnswerAuditPayload(m.text)?.answerTs === item.ts,
					)
				: undefined,
	}))
	const scrollEntries = items.map((item): AiHydroMessage | AiHydroMessage[] => {
		switch (item.kind) {
			case "group":
				return item.members
			case "passthrough":
				return item.messages
			default:
				return item.message
		}
	})
	return { entries, scrollEntries }
}
