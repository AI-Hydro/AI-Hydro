/**
 * What actually happened to a call that needed (or skipped) permission, derived from evidence in the message
 * stream and never from row position or from "the user said yes".
 *
 * Evidence, strongest first:
 *  1. `askOutcome` (the user's recorded Run/Deny decision) and `execOutcome` (the host records "completed" or
 *     "failed" when the tool's result is returned; see ToolExecutor).
 *  2. Rows that exist only because the call ran: command output or `commandCompleted`, an MCP response (a body that
 *     starts "Error:" is a failure), an edit the user adjusted (`user_feedback_diff`), or an error row.
 * Without evidence a call is only "approved" (asked and allowed) or, for an auto-run row in the live tail, "running".
 * An ask that was superseded with no evidence is "unknown": the UI says "asked to ...", never a past-tense claim.
 *
 * Pure: no React, no webview imports.
 */
import type { AiHydroAsk, AiHydroMessage } from "../ExtensionMessage"
import type { AiHydroAskResponse } from "../WebviewMessage"

export type CallState = "pending" | "approved" | "running" | "executed" | "failed" | "denied" | "unknown"

/** @deprecated kept so older imports keep compiling; use CallState. */
export type AskOutcome = CallState

/** Asks whose answer is a run/deny decision on a single call. */
export const APPROVAL_ASKS: readonly AiHydroAsk[] = ["tool", "command", "use_mcp_server", "browser_action_launch"]

const CALL_KINDS = ["tool", "command", "use_mcp_server", "browser_action_launch"]

/** Outcome the host records for an answered ask. A typed message instead of a button press is a rejection (ToolResultUtils). */
export function recordedOutcomeFor(ask: AiHydroAsk, response: AiHydroAskResponse): "approved" | "denied" | undefined {
	if (!APPROVAL_ASKS.includes(ask)) {
		return undefined
	}
	return response === "yesButtonClicked" ? "approved" : "denied"
}

/** True for a row that represents one call (ask or say). */
export function isCallRow(message: AiHydroMessage): boolean {
	return CALL_KINDS.includes((message.type === "ask" ? message.ask : message.say) ?? "")
}

const COMMAND_OUTPUT_MARKER = "Output:"
const FAILURE_SAYS = ["error", "diff_error", "aihydroignore_error"]

type Evidence = "executed" | "failed" | "running" | undefined

/** Evidence in the rows that follow `message` and belong to the same call (up to the next turn, call, or ask). */
function windowEvidence(message: AiHydroMessage, later: readonly AiHydroMessage[]): Evidence {
	const kind = message.type === "ask" ? message.ask : message.say
	if (kind === "command" && (message.commandCompleted || message.text?.includes(COMMAND_OUTPUT_MARKER))) {
		return "executed"
	}
	let started = false
	for (const row of later) {
		const rowKind = row.type === "ask" ? row.ask : row.say
		if (rowKind === "command_output") {
			if (kind === "command") {
				return "executed"
			}
			continue
		}
		// Anything that starts a new turn, call or question ends this call's window.
		if (
			row.type === "ask" ||
			row.say === "api_req_started" ||
			row.say === "user_feedback" ||
			row.say === "completion_result" ||
			isCallRow(row)
		) {
			break
		}
		if (row.say && FAILURE_SAYS.includes(row.say)) {
			return "failed"
		}
		if (kind === "use_mcp_server") {
			if (row.say === "mcp_server_request_started") {
				started = true
			}
			if (row.say === "mcp_server_response") {
				return row.text?.trimStart().startsWith("Error:") ? "failed" : "executed"
			}
		}
		if (kind === "tool" && row.say === "user_feedback_diff") {
			return "executed"
		}
	}
	return started ? "running" : undefined
}

/**
 * @param message the call row being rendered (ask or say)
 * @param messages the full raw stream (used for later rows only)
 */
export function deriveCallState(message: AiHydroMessage, messages: readonly AiHydroMessage[]): CallState {
	if (message.askOutcome === "denied") {
		return "denied"
	}
	if (message.execOutcome === "failed") {
		return "failed"
	}

	let index = -1
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].ts === message.ts) {
			index = i
			break
		}
	}
	const later = index >= 0 ? messages.slice(index + 1) : []
	const isTail = index < 0 || index === messages.length - 1
	let evidence = windowEvidence(message, later)
	// An error after an ask nobody answered cannot be attributed to that call (it may never have run).
	if (message.type === "ask" && !message.askOutcome && evidence === "failed") {
		evidence = undefined
	}
	if (evidence === "failed") {
		return "failed" // e.g. an MCP response that reports an error, even though the host got a result back
	}
	if (message.execOutcome === "completed" || evidence === "executed") {
		return "executed"
	}

	if (message.type === "ask") {
		if (message.askOutcome === "approved") {
			return evidence === "running" ? "running" : "approved"
		}
		return isTail ? "pending" : evidence === "running" ? "running" : "unknown"
	}

	// A say row is emitted before the tool starts (auto-run, YOLO, a policy "run"): it proves nothing about the result.
	if (evidence === "running") {
		return "running"
	}
	// The turn has moved on once a new API request starts or any later ask appears (including resume_task after an
	// interruption); without evidence the call is then "unknown", never "running" forever.
	const turnAdvanced = later.some((row) => row.say === "api_req_started" || row.type === "ask")
	return turnAdvanced ? "unknown" : "running"
}

/** @deprecated use deriveCallState. */
export const deriveAskOutcome = deriveCallState

/**
 * Index of the row a just-returned tool result belongs to: the latest call row of the current turn that was
 * approved or auto-run and has no recorded execution yet. A denied or unanswered ask never ran, so it is skipped.
 */
export function callRowIndexToRecord(messages: readonly AiHydroMessage[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		const row = messages[i]
		if (row.say === "api_req_started") {
			return -1 // only rows from the current turn can belong to this call
		}
		if (!isCallRow(row)) {
			continue
		}
		if (row.execOutcome || row.askOutcome === "denied" || (row.type === "ask" && row.askOutcome !== "approved")) {
			return -1
		}
		return i
	}
	return -1
}
