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
	/**
	 * "Rewind to this message" targets by user entry key: the first checkpoint after the user turn, before the next
	 * one. Computed over the full presenter output, so a turn with no tool work (its group is not shown) still has one.
	 */
	rewinds: Map<string, number>
	/** One entry per row, in the shape useScrollBehavior understands (a message, or the messages a row covers). */
	scrollEntries: (AiHydroMessage | AiHydroMessage[])[]
}

/**
 * Builds what the list renders. `verbose` is today's pipeline untouched (filter + browser-session grouping); every
 * other level runs the presenter on the UNFILTERED processed list, so nothing the filter drops is lost to it.
 */
/**
 * A work group that carries nothing to show: no tool ran, nothing was refused, failed, retried, reused or revised.
 * It is only the machinery of a plain answer (a model request and a checkpoint), and its "Worked <1s" header
 * would be noise. Its cost is still in the task header; its checkpoint still serves "Rewind" on the user turn.
 */
export function isEmptyWorkGroup(item: TranscriptItem): boolean {
	if (item.kind !== "group") {
		return false
	}
	const f = item.facts
	return (
		f.toolCount === 0 &&
		f.notRunCount === 0 &&
		f.liftedCount === 0 &&
		f.retryCount === 0 &&
		f.failedRequestCount === 0 &&
		f.reuseCount === 0 &&
		f.revisionCount === 0 &&
		item.lifted.length === 0 &&
		item.absorbed.length === 0
	)
}

/**
 * "Resumed a completed task": the divider the presenter draws when a follow-up resumes a finished task. The user's
 * question follows at once and nothing was cut off, so it only repeats above every follow-up. (An interrupted task's
 * divider stays: work was lost.) The presenter still emits it (it surfaces every break message); the view hides it.
 */
export function isRoutineResume(item: TranscriptItem): boolean {
	return item.kind === "divider" && item.dividerKind === "resumed" && item.message.ask === "resume_completed_task"
}

function rewindTargets(items: TranscriptItem[]): Map<string, number> {
	const out = new Map<string, number>()
	items.forEach((item, i) => {
		if (item.kind !== "user") {
			return
		}
		for (let j = i + 1; j < items.length; j++) {
			const next = items[j]
			if (next.kind === "user") {
				break
			}
			if (next.kind === "group") {
				const checkpoint = next.members.find((m) => m.say === "checkpoint_created")
				if (checkpoint) {
					out.set(item.key, checkpoint.ts)
					return
				}
			}
		}
	})
	return out
}

export function buildTranscriptView(
	processed: AiHydroMessage[],
	grouped: (AiHydroMessage | AiHydroMessage[])[],
	options: PresentOptions & { running?: boolean },
): TranscriptView {
	if (options.detail === "verbose") {
		return {
			rewinds: new Map(),
			entries: grouped.map((entry, i) => ({
				mode: "legacy" as const,
				key: Array.isArray(entry) ? `legacy:${entry[0]?.ts}:${i}` : `legacy:${entry.ts}:${i}`,
				entry,
			})),
			scrollEntries: grouped,
		}
	}
	const all = presentTranscript(processed, options)
	const rewinds = rewindTargets(all)
	// The live tail group is the "Working" row, so it stays even while empty; any other empty group is dropped.
	const items = all.filter(
		(item, i) => !isRoutineResume(item) && (!isEmptyWorkGroup(item) || (!!options.running && i === all.length - 1)),
	)
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
	return { entries, scrollEntries, rewinds }
}
