import type { AiHydroAskResponse } from "@shared/WebviewMessage"
import type { TaskState } from "./TaskState"

/**
 * Binds a webview ask response to the ask it answers (W2-E1, M-1). Each click carries the ts of the ask message it
 * was generated for. `taskState.lastMessageTs` is the ts of the ask the host is waiting on: `Task.ask` sets it when
 * it posts the ask, and any later ask or say moves it, which is also how `Task.ask` knows it was superseded. A
 * response whose ts differs belongs to an ask that has since changed and must not answer the new one (a stale
 * "Run" click landing on a different command, or on a tool call that appeared after an Always toggle).
 *
 * `askTs` of 0 or undefined is the legacy/internal path (auto-retry, older webview callers) and is accepted.
 */
export interface AskResponseInput {
	response: AiHydroAskResponse
	text?: string
	images?: string[]
	files?: string[]
	askTs?: number
}

export function acceptAskResponse(
	state: Pick<TaskState, "askResponse" | "askResponseText" | "askResponseImages" | "askResponseFiles" | "lastMessageTs">,
	input: AskResponseInput,
): { stale: boolean } {
	const askTs = input.askTs ?? 0
	if (askTs !== 0 && askTs !== state.lastMessageTs) {
		console.warn(`askResponse: dropped stale response for ask ${askTs}; pending ask is ${state.lastMessageTs ?? "none"}`)
		return { stale: true }
	}
	state.askResponse = input.response
	state.askResponseText = input.text
	state.askResponseImages = input.images
	state.askResponseFiles = input.files
	return { stale: false }
}
