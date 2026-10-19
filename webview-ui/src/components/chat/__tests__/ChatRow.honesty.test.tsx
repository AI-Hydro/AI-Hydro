import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { render, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ChatRowContent } from "../ChatRow"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mcpServers: [],
		mcpMarketplaceCatalog: { items: [] },
		onRelinquishControl: () => () => {},
		vscodeTerminalExecutionMode: "vscodeTerminal",
		aihydroMessages: [],
		autoApprovalSettings: { enabled: false, actions: {} },
	}),
}))
vi.mock("@/context/HtmlPreviewContext", () => ({
	useHtmlPreviewContext: () => ({ items: [] }),
}))
vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {},
	TaskServiceClient: {},
	UiServiceClient: {},
}))
vi.mock("../../../context/LedgerContext", () => ({
	useLedgerContext: () => ({
		getClaim: (claimId: string) => ({
			claimId,
			statement: "Baseflow index is 0.42",
			status: "supported",
			confidence: "medium",
			evidenceSpans: [],
			limitations: [],
			revisionDigest: "sha256:abc",
		}),
	}),
}))

const GREEN = /charts-green|testing-iconPassed|bg-success|text-success|chip-emerald|#176f2c/

function renderRow(message: AiHydroMessage, isLast = true) {
	return render(
		<ChatRowContent
			isExpanded={false}
			isLast={isLast}
			lastModifiedMessage={message}
			message={message}
			onSetQuote={() => {}}
			onToggleExpand={() => {}}
		/>,
	)
}

const completion = (type: "say" | "ask"): AiHydroMessage =>
	type === "say"
		? { ts: 1, type: "say", say: "completion_result", text: "Baseflow index is 0.42. [claim:c-1]" }
		: { ts: 1, type: "ask", ask: "completion_result", text: "Baseflow index is 0.42. [claim:c-1]" }

describe("final answer carries no green", () => {
	for (const kind of ["say", "ask"] as const) {
		it(`completion_result (${kind}) renders neutral: no green token anywhere in the row`, async () => {
			const { container } = renderRow(completion(kind))
			// The Markdown body (and the claim chip inside it) renders asynchronously.
			await waitFor(() => expect(container.textContent).toContain("Baseflow index is 0.42."))
			await waitFor(() => expect(container.querySelector("[data-evidence-state]")).not.toBeNull())
			expect(container.innerHTML).not.toMatch(GREEN)
			expect(container.textContent).toContain("Answer")
			expect(container.textContent).not.toContain("Task Completed")
			// The unapproved claim chip shows its real state, not approval.
			expect(container.querySelector("[data-evidence-state]")?.getAttribute("data-evidence-state")).toBe("unverified")
		})
	}
})

describe("tense of tool-call headers", () => {
	const tool = (tool: string, extra: object = {}) => JSON.stringify({ tool, path: "a.py", content: "x", ...extra })
	const cases: Array<[string, string, string, string]> = [
		["readFile", "AI Hydro wants to read this file:", "AI Hydro read this file:", tool("readFile")],
		["editedExistingFile", "AI Hydro wants to edit this file:", "AI Hydro edited this file:", tool("editedExistingFile")],
		["newFileCreated", "AI Hydro wants to create a new file:", "AI Hydro created a new file:", tool("newFileCreated")],
	]
	for (const [name, pending, done, text] of cases) {
		it(`${name}: "wants to" only while pending`, () => {
			const ask: AiHydroMessage = { ts: 2, type: "ask", ask: "tool", text }
			expect(renderRow(ask, true).container.textContent).toContain(pending)
			expect(renderRow(ask, false).container.textContent).toContain(done)
			expect(renderRow(ask, false).container.textContent).not.toContain("wants to")
			const say: AiHydroMessage = { ts: 2, type: "say", say: "tool", text }
			expect(renderRow(say, true).container.textContent).toContain(done)
		})
	}

	it("MCP tool header: pending ask reads 'wants to use a tool', an executed call reads 'used a tool'", () => {
		const text = JSON.stringify({ type: "use_mcp_tool", serverName: "other", toolName: "t", arguments: "{}" })
		const ask: AiHydroMessage = { ts: 3, type: "ask", ask: "use_mcp_server", text }
		expect(renderRow(ask, true).container.textContent).toContain("wants to use a tool")
		const done = renderRow({ ...ask, type: "say", ask: undefined, say: "use_mcp_server" } as AiHydroMessage, true)
		expect(done.container.textContent).toContain("used a tool")
		expect(done.container.textContent).not.toContain("wants to")
		expect(renderRow(ask, false).container.textContent).toContain("used a tool")
	})

	it("science card says nothing has run while awaiting permission", () => {
		const text = JSON.stringify({ type: "use_mcp_tool", serverName: "ai-hydro", toolName: "describe_tool", arguments: "{}" })
		const ask: AiHydroMessage = { ts: 4, type: "ask", ask: "use_mcp_server", text }
		expect(renderRow(ask, true).container.textContent).toContain("Not run yet: waiting for your permission.")
		expect(renderRow(ask, true).container.textContent).not.toContain("No result recorded yet.")
	})
})
