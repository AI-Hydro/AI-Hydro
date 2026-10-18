import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { filterVisibleMessages } from "../chat-view/utils/messageUtils"

const call = (ts: number, serverName: string): AiHydroMessage => ({
	ts,
	type: "say",
	say: "use_mcp_server",
	text: JSON.stringify({ serverName, type: "use_mcp_tool", toolName: "x", arguments: "{}" }),
})
const response = (ts: number): AiHydroMessage => ({ ts, type: "say", say: "mcp_server_response", text: "{}" })

describe("filterVisibleMessages: science tool results", () => {
	it("drops the raw response row of a first-party call (the card shows it)", () => {
		const out = filterVisibleMessages([call(1, "ai-hydro"), response(2)])
		expect(out.map((m) => m.ts)).toEqual([1])
	})
	it("keeps the response row of any other server", () => {
		const out = filterVisibleMessages([call(1, "github"), response(2)])
		expect(out.map((m) => m.ts)).toEqual([1, 2])
	})
	it("keeps a response with no preceding call", () => {
		expect(filterVisibleMessages([response(2)]).map((m) => m.ts)).toEqual([2])
	})
})
