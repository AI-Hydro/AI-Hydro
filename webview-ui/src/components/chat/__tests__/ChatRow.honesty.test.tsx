import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { render, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ChatRowContent } from "../ChatRow"

let stream: AiHydroMessage[] = []

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mcpServers: [],
		mcpMarketplaceCatalog: { items: [] },
		onRelinquishControl: () => () => {},
		vscodeTerminalExecutionMode: "vscodeTerminal",
		aihydroMessages: stream,
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

/** Render `message` as part of `rest` (rows that follow it in the stream). */
function renderRow(message: AiHydroMessage, rest: AiHydroMessage[] = []) {
	stream = [message, ...rest]
	const isLast = rest.length === 0
	return render(
		<ChatRowContent
			isExpanded={false}
			isLast={isLast}
			lastModifiedMessage={stream[stream.length - 1]}
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

const later = (n = 1): AiHydroMessage[] =>
	Array.from({ length: n }, (_, i) => ({ ts: 100 + i, type: "say", say: "api_req_started", text: "{}" }) as AiHydroMessage)

describe("tense of tool-call headers comes from the outcome, not position", () => {
	const tool = (name: string) => JSON.stringify({ tool: name, path: "a.py", content: "x" })
	const cases: Array<[string, string, string, string, string]> = [
		[
			"readFile",
			"wants to read this file:",
			"AI Hydro read this file:",
			"Denied: read this file (not run)",
			tool("readFile"),
		],
		[
			"editedExistingFile",
			"wants to edit this file:",
			"AI Hydro edited this file:",
			"Denied: edit this file (not run)",
			tool("editedExistingFile"),
		],
		[
			"newFileCreated",
			"wants to create a new file:",
			"AI Hydro created a new file:",
			"Denied: create a new file (not run)",
			tool("newFileCreated"),
		],
	]
	for (const [name, pending, done, denied, text] of cases) {
		describe(name, () => {
			const ask: AiHydroMessage = { ts: 2, type: "ask", ask: "tool", text }
			it("pending: last row, no outcome", () => {
				expect(renderRow(ask).container.textContent).toContain(pending)
			})
			it("approved and executed: past tense only with a recorded approval", () => {
				const t = renderRow({ ...ask, askOutcome: "approved" }, later()).container.textContent
				expect(t).toContain(done)
				expect(t).not.toContain("wants to")
			})
			it("denied, then a later row: 'Denied ... (not run)', never past tense", () => {
				const t = renderRow({ ...ask, askOutcome: "denied" }, later(2)).container.textContent
				expect(t).toContain(denied)
				expect(t).not.toContain("wants to")
				expect(t).not.toContain(done)
			})
			it("resumed from history (superseded, no evidence): 'asked to', never past tense", () => {
				const resume: AiHydroMessage = { ts: 50, type: "ask", ask: "resume_task" }
				const t = renderRow(ask, [resume]).container.textContent
				expect(t).toContain("asked to")
				expect(t).not.toContain(done)
				expect(t).not.toContain("wants to")
			})
			it("cancelled or errored (later row, no evidence): 'asked to'", () => {
				const error: AiHydroMessage = { ts: 60, type: "say", say: "error", text: "boom" }
				const t = renderRow(ask, [error]).container.textContent
				expect(t).toContain("asked to")
				expect(t).not.toContain(done)
			})
			it("a say row is an executed call", () => {
				const say: AiHydroMessage = { ts: 2, type: "say", say: "tool", text }
				expect(renderRow(say).container.textContent).toContain(done)
			})
		})
	}

	describe("command", () => {
		const ask: AiHydroMessage = { ts: 5, type: "ask", ask: "command", text: "ls" }
		it("pending / denied / unknown / executed", () => {
			expect(renderRow(ask).container.textContent).toContain("wants to execute this command:")
			expect(renderRow({ ...ask, askOutcome: "denied" }, later()).container.textContent).toContain(
				"Denied: execute this command (not run)",
			)
			const unknown = renderRow(ask, later()).container.textContent
			expect(unknown).toContain("asked to execute this command:")
			expect(unknown).not.toContain("ran this command")
			expect(renderRow({ ...ask, askOutcome: "approved" }, later()).container.textContent).toContain(
				"AI Hydro ran this command:",
			)
		})
		it("legacy recording: following command_output is evidence it ran", () => {
			const output: AiHydroMessage = { ts: 6, type: "say", say: "command_output", text: "ok" }
			expect(renderRow(ask, [output]).container.textContent).toContain("AI Hydro ran this command:")
		})
	})

	describe("MCP tool", () => {
		const text = JSON.stringify({ type: "use_mcp_tool", serverName: "other", toolName: "t", arguments: "{}" })
		const ask: AiHydroMessage = { ts: 3, type: "ask", ask: "use_mcp_server", text }
		it("pending / denied / unknown / executed", () => {
			expect(renderRow(ask).container.textContent).toContain("wants to use a tool")
			const denied = renderRow({ ...ask, askOutcome: "denied" }, later()).container.textContent
			expect(denied).toContain("Denied: use a tool")
			expect(denied).toContain("(not run)")
			const unknown = renderRow(ask, later()).container.textContent
			expect(unknown).toContain("asked to use a tool")
			expect(unknown).not.toContain("used a tool")
			const done = renderRow({ ...ask, askOutcome: "approved" }, later()).container.textContent
			expect(done).toContain("used a tool")
			expect(done).not.toContain("wants to")
		})
		it("a say row, and a legacy ask followed by the server request, read as executed", () => {
			const say = renderRow({ ...ask, type: "say", ask: undefined, say: "use_mcp_server" } as AiHydroMessage).container
			expect(say.textContent).toContain("used a tool")
			const started: AiHydroMessage = { ts: 7, type: "say", say: "mcp_server_request_started" }
			expect(renderRow(ask, [started]).container.textContent).toContain("used a tool")
		})
	})

	describe("science card", () => {
		const text = JSON.stringify({ type: "use_mcp_tool", serverName: "ai-hydro", toolName: "describe_tool", arguments: "{}" })
		const ask: AiHydroMessage = { ts: 4, type: "ask", ask: "use_mcp_server", text }
		it("says nothing has run while pending, and that it was not run once denied", () => {
			const pending = renderRow(ask).container.textContent
			expect(pending).toContain("Not run yet: waiting for your permission.")
			expect(pending).not.toContain("No result recorded yet.")
			expect(renderRow({ ...ask, askOutcome: "denied" }, later()).container.textContent).toContain(
				"Not run: you denied this call.",
			)
		})
	})
})
