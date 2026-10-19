/**
 * What actually happened to a permission ask, derived from evidence in the message stream (never from position).
 *
 * The host records `askOutcome` on an approval ask when the user answers it (see Task.ask). For older recordings
 * that lack it, only rows that exist because the call ran count as evidence (command output, an MCP request or
 * response). Anything else is "unknown": the UI says "asked to ...", never a past-tense claim.
 *
 * Pure: no React, no webview imports.
 */
import type { AiHydroAsk, AiHydroMessage } from "../ExtensionMessage"
import type { AiHydroAskResponse } from "../WebviewMessage"

export type AskOutcome = "pending" | "executed" | "denied" | "unknown"

/** Asks whose answer is a run/deny decision on a single call. */
export const APPROVAL_ASKS: readonly AiHydroAsk[] = ["tool", "command", "use_mcp_server", "browser_action_launch"]

/** Outcome the host records for an answered ask. A typed message instead of a button press is a rejection (ToolResultUtils). */
export function recordedOutcomeFor(ask: AiHydroAsk, response: AiHydroAskResponse): "approved" | "denied" | undefined {
	if (!APPROVAL_ASKS.includes(ask)) {
		return undefined
	}
	return response === "yesButtonClicked" ? "approved" : "denied"
}

const COMMAND_OUTPUT_MARKER = "Output:"

/**
 * @param message the ask row being rendered
 * @param messages the full raw stream (used for later rows only)
 */
export function deriveAskOutcome(message: AiHydroMessage, messages: readonly AiHydroMessage[]): AskOutcome {
	// A `say` row is something that already happened (an auto-approved or completed call).
	if (message.type !== "ask") {
		return "executed"
	}
	if (message.askOutcome === "denied") {
		return "denied"
	}
	if (message.askOutcome === "approved") {
		return "executed"
	}

	let index = -1
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].ts === message.ts) {
			index = i
			break
		}
	}
	// Not in the stream (e.g. a combined or synthetic row): the row is the last thing we know about.
	const later = index >= 0 ? messages.slice(index + 1) : []
	if (index === messages.length - 1 || (index < 0 && later.length === 0)) {
		return "pending"
	}

	// Legacy recordings: only rows that exist because the call ran are evidence.
	if (message.ask === "command") {
		if (message.commandCompleted || message.text?.includes(COMMAND_OUTPUT_MARKER)) {
			return "executed"
		}
		const next = later[0]
		if (next && (next.say === "command_output" || next.ask === "command_output")) {
			return "executed"
		}
	}
	if (message.ask === "use_mcp_server") {
		const next = later[0]
		if (next && (next.say === "mcp_server_request_started" || next.say === "mcp_server_response")) {
			return "executed"
		}
	}
	return "unknown"
}
