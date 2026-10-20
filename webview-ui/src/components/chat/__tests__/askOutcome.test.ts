import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { callRowIndexToRecord, deriveCallState, recordedOutcomeFor } from "@shared/aihydro/askOutcome"
import { describe, expect, it } from "vitest"

const ask = (extra: Partial<AiHydroMessage> = {}): AiHydroMessage => ({ ts: 1, type: "ask", ask: "tool", text: "{}", ...extra })
const say = (ts: number, kind: AiHydroMessage["say"], extra: Partial<AiHydroMessage> = {}): AiHydroMessage => ({
	ts,
	type: "say",
	say: kind,
	...extra,
})

describe("deriveCallState: asks", () => {
	it("pending only when nothing follows and nothing is recorded", () => {
		const a = ask()
		expect(deriveCallState(a, [a])).toBe("pending")
		expect(deriveCallState(a, [a, say(2, "api_req_started")])).toBe("unknown")
	})
	it("denied is recorded", () => {
		const denied = ask({ askOutcome: "denied" })
		expect(deriveCallState(denied, [denied, say(2, "text")])).toBe("denied")
	})
	it("approved is not executed: it needs completion evidence", () => {
		const ok = ask({ askOutcome: "approved" })
		expect(deriveCallState(ok, [ok])).toBe("approved")
		expect(deriveCallState(ok, [ok, say(2, "api_req_started")])).toBe("approved")
		const done = ask({ askOutcome: "approved", execOutcome: "completed" })
		expect(deriveCallState(done, [done])).toBe("executed")
		const failed = ask({ askOutcome: "approved", execOutcome: "failed" })
		expect(deriveCallState(failed, [failed])).toBe("failed")
	})
	it("approved then failed or aborted", () => {
		const ok = ask({ askOutcome: "approved" })
		expect(deriveCallState(ok, [ok, say(2, "error")])).toBe("failed")
		expect(deriveCallState(ok, [ok, say(2, "diff_error")])).toBe("failed")
		// aborted: the turn moved on with no result and no error
		expect(deriveCallState(ok, [ok, say(2, "api_req_started"), say(3, "text")])).toBe("approved")
		// an error after the next turn started belongs to that turn, not to this call
		expect(deriveCallState(ok, [ok, say(2, "api_req_started"), say(3, "error")])).toBe("approved")
	})
	it("a recorded completion does not hide an MCP error response", () => {
		const mcp = ask({ ask: "use_mcp_server", askOutcome: "approved", execOutcome: "completed" })
		expect(deriveCallState(mcp, [mcp, say(2, "mcp_server_response", { text: "Error:\nbad" })])).toBe("failed")
	})
	it("command evidence: output or commandCompleted", () => {
		const cmd = ask({ ask: "command", askOutcome: "approved" })
		expect(deriveCallState(cmd, [cmd, say(2, "command_output")])).toBe("executed")
		expect(deriveCallState({ ...cmd, commandCompleted: true }, [cmd])).toBe("executed")
		expect(deriveCallState({ ...cmd, text: "ls\nOutput:\nx" }, [cmd])).toBe("executed")
	})
	it("MCP evidence: a response, with an Error: body meaning failure; a request alone is running", () => {
		const mcp = ask({ ask: "use_mcp_server", askOutcome: "approved" })
		expect(deriveCallState(mcp, [mcp, say(2, "mcp_server_response", { text: "ok" })])).toBe("executed")
		expect(deriveCallState(mcp, [mcp, say(2, "mcp_server_response", { text: "Error:\nbad" })])).toBe("failed")
		expect(deriveCallState(mcp, [mcp, say(2, "mcp_server_request_started")])).toBe("running")
	})
	it("edit evidence: the user's applied diff", () => {
		const edit = ask({ askOutcome: "approved" })
		expect(deriveCallState(edit, [edit, say(2, "user_feedback_diff")])).toBe("executed")
	})
	it("an unanswered superseded ask is unknown (an error cannot be attributed to it); legacy command output still counts", () => {
		const cmd = ask({ ask: "command" })
		expect(deriveCallState(cmd, [cmd, say(2, "error")])).toBe("unknown")
		expect(deriveCallState(cmd, [cmd, say(2, "command_output")])).toBe("executed")
		expect(deriveCallState(cmd, [cmd, say(2, "text")])).toBe("unknown")
	})
})

describe("deriveCallState: say rows are emitted before the tool starts", () => {
	it("running until evidence", () => {
		const row = say(1, "tool")
		expect(deriveCallState(row, [row])).toBe("running")
		expect(deriveCallState(row, [row, say(2, "text")])).toBe("running")
	})
	it("executed or failed with evidence", () => {
		expect(deriveCallState(say(1, "tool", { execOutcome: "completed" }), [])).toBe("executed")
		expect(deriveCallState(say(1, "tool", { execOutcome: "failed" }), [])).toBe("failed")
		const row = say(1, "tool")
		expect(deriveCallState(row, [row, say(2, "error")])).toBe("failed")
		const mcp = say(1, "use_mcp_server")
		expect(deriveCallState(mcp, [mcp, say(2, "mcp_server_response", { text: "ok" })])).toBe("executed")
		const cmd = say(1, "command")
		expect(deriveCallState(cmd, [cmd, say(2, "command_output")])).toBe("executed")
	})
	it("unknown when the turn advanced with no evidence (recorded before completion was tracked)", () => {
		const row = say(1, "tool")
		expect(deriveCallState(row, [row, say(2, "api_req_started")])).toBe("unknown")
	})
})

describe("recordedOutcomeFor", () => {
	it("maps button presses; a typed reply to a call ask is a denial", () => {
		expect(recordedOutcomeFor("tool", "yesButtonClicked")).toBe("approved")
		expect(recordedOutcomeFor("command", "noButtonClicked")).toBe("denied")
		expect(recordedOutcomeFor("use_mcp_server", "messageResponse")).toBe("denied")
	})
	it("records nothing for asks that are not run/deny decisions", () => {
		expect(recordedOutcomeFor("followup", "yesButtonClicked")).toBeUndefined()
		expect(recordedOutcomeFor("command_output", "noButtonClicked")).toBeUndefined()
	})
})

describe("callRowIndexToRecord", () => {
	it("picks the approved ask or auto-run row of the current turn", () => {
		const approved = ask({ ts: 2, askOutcome: "approved" })
		expect(callRowIndexToRecord([say(1, "api_req_started"), approved])).toBe(1)
		const auto = say(2, "tool")
		expect(callRowIndexToRecord([say(1, "api_req_started"), auto, say(3, "text")])).toBe(1)
	})
	it("skips denied, unanswered, already-recorded and previous-turn rows", () => {
		expect(callRowIndexToRecord([say(1, "api_req_started"), ask({ ts: 2, askOutcome: "denied" })])).toBe(-1)
		expect(callRowIndexToRecord([say(1, "api_req_started"), ask({ ts: 2 })])).toBe(-1)
		expect(callRowIndexToRecord([say(1, "api_req_started"), say(2, "tool", { execOutcome: "completed" })])).toBe(-1)
		expect(callRowIndexToRecord([say(0, "tool"), say(1, "api_req_started")])).toBe(-1)
	})
})
