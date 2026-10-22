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
	state: Pick<
		TaskState,
		| "askResponse"
		| "askResponseText"
		| "askResponseImages"
		| "askResponseFiles"
		| "lastMessageTs"
		| "answeredAskTs"
		| "commandOutputStream"
	>,
	input: AskResponseInput,
): { stale: boolean } {
	const askTs = input.askTs ?? 0
	if (askTs !== 0) {
		if (askTs !== state.lastMessageTs && !sameCommandOutputStream(state, askTs)) {
			console.warn(`askResponse: dropped stale response for ask ${askTs}; pending ask is ${state.lastMessageTs ?? "none"}`)
			return { stale: true }
		}
		// Double delivery: the pending ask was already answered; a second answer must not leak into the next ask.
		if (state.lastMessageTs !== undefined && state.answeredAskTs === state.lastMessageTs) {
			console.warn(`askResponse: dropped duplicate response for ask ${askTs}; it was already answered`)
			return { stale: true }
		}
	}
	state.answeredAskTs = state.lastMessageTs
	state.askResponse = input.response
	state.askResponseText = input.text
	state.askResponseImages = input.images
	state.askResponseFiles = input.files
	return { stale: false }
}

/**
 * `askTs` is an earlier chunk of the same command's output stream and the pending ask is also a chunk of that
 * stream. Strict otherwise: a `command_output` ts never answers any other kind of ask, and a ts from a finished
 * command's stream is not in the current set.
 */
function sameCommandOutputStream(state: Pick<TaskState, "lastMessageTs" | "commandOutputStream">, askTs: number): boolean {
	const stream = state.commandOutputStream
	return !!stream && state.lastMessageTs !== undefined && stream.askTs.has(askTs) && stream.askTs.has(state.lastMessageTs)
}

/**
 * Clears the previous response when an ask is (re)posted or a partial ask completes, including the answered
 * marker: a response accepted while the ask was still partial must not block the click on its completed form.
 */
export function resetAskResponse(
	state: Pick<TaskState, "askResponse" | "askResponseText" | "askResponseImages" | "askResponseFiles" | "answeredAskTs">,
): void {
	state.askResponse = undefined
	state.askResponseText = undefined
	state.askResponseImages = undefined
	state.askResponseFiles = undefined
	state.answeredAskTs = undefined
}
