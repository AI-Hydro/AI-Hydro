import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { deriveAskOutcome, recordedOutcomeFor } from "@shared/aihydro/askOutcome"
import { describe, expect, it } from "vitest"

const ask = (extra: Partial<AiHydroMessage> = {}): AiHydroMessage => ({ ts: 1, type: "ask", ask: "tool", text: "{}", ...extra })
const say = (ts: number, kind: AiHydroMessage["say"]): AiHydroMessage => ({ ts, type: "say", say: kind })

describe("deriveAskOutcome", () => {
	it("pending only when nothing follows", () => {
		const a = ask()
		expect(deriveAskOutcome(a, [a])).toBe("pending")
		expect(deriveAskOutcome(a, [a, say(2, "api_req_started")])).toBe("unknown")
	})
	it("recorded decisions win over position", () => {
		const denied = ask({ askOutcome: "denied" })
		expect(deriveAskOutcome(denied, [denied])).toBe("denied")
		const ok = ask({ askOutcome: "approved" })
		expect(deriveAskOutcome(ok, [ok, say(2, "text")])).toBe("executed")
	})
	it("say rows are executed", () => {
		expect(deriveAskOutcome(say(1, "tool"), [])).toBe("executed")
	})
	it("legacy evidence: command output / MCP request, nothing else", () => {
		const cmd = ask({ ask: "command" })
		expect(deriveAskOutcome(cmd, [cmd, say(2, "command_output")])).toBe("executed")
		expect(deriveAskOutcome(cmd, [cmd, say(2, "error")])).toBe("unknown")
		const mcp = ask({ ask: "use_mcp_server" })
		expect(deriveAskOutcome(mcp, [mcp, say(2, "mcp_server_request_started")])).toBe("executed")
		expect(deriveAskOutcome(mcp, [mcp, say(2, "text")])).toBe("unknown")
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
