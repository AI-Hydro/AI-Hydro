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
const errorRow: AiHydroMessage = { ts: 60, type: "say", say: "error", text: "boom" }

describe("tense of tool-call headers comes from evidence, not position or approval", () => {
	const tool = (name: string) => JSON.stringify({ tool: name, path: "a.py", content: "x" })
	const cases: Array<[string, string, string, string, string]> = [
		["readFile", "read this file", "AI-Hydro read this file:", "Denied: read this file (not run)", tool("readFile")],
		[
			"editedExistingFile",
			"edit this file",
			"AI-Hydro edited this file:",
			"Denied: edit this file (not run)",
			tool("editedExistingFile"),
		],
		[
			"newFileCreated",
			"create a new file",
			"AI-Hydro created a new file:",
			"Denied: create a new file (not run)",
			tool("newFileCreated"),
		],
	]
	for (const [name, noun, done, denied, text] of cases) {
		describe(name, () => {
			const ask: AiHydroMessage = { ts: 2, type: "ask", ask: "tool", text }
			it("pending: last row, no outcome", () => {
				expect(renderRow(ask).container.textContent).toContain(`wants to ${noun}:`)
			})
			it("approved with no execution evidence: 'Approved', never past tense", () => {
				const t = renderRow({ ...ask, askOutcome: "approved" }, later()).container.textContent
				expect(t).toContain(`Approved: ${noun}:`)
				expect(t).not.toContain(done)
				expect(t).not.toContain("wants to")
			})
			it("approved then aborted (turn moved on, nothing recorded): still only 'Approved'", () => {
				const t = renderRow({ ...ask, askOutcome: "approved" }, later(3)).container.textContent
				expect(t).toContain(`Approved: ${noun}:`)
				expect(t).not.toContain(done)
			})
			it("approved then executed (host recorded completion): past tense", () => {
				const t = renderRow({ ...ask, askOutcome: "approved", execOutcome: "completed" }, later()).container.textContent
				expect(t).toContain(done)
				expect(t).not.toContain("Approved:")
			})
			it("approved then failed (recorded failure, or an error row follows): 'Failed'", () => {
				const recorded = renderRow({ ...ask, askOutcome: "approved", execOutcome: "failed" }, later()).container
					.textContent
				expect(recorded).toContain(`Failed: ${noun}:`)
				expect(recorded).not.toContain(done)
				const viaRow = renderRow({ ...ask, askOutcome: "approved" }, [errorRow]).container.textContent
				expect(viaRow).toContain(`Failed: ${noun}:`)
				expect(viaRow).not.toContain(done)
			})
			it("denied, then a later row: 'Denied ... (not run)'", () => {
				const t = renderRow({ ...ask, askOutcome: "denied" }, later(2)).container.textContent
				expect(t).toContain(denied)
				expect(t).not.toContain("wants to")
				expect(t).not.toContain(done)
			})
			it("resumed from history, cancelled or errored with no evidence: 'asked to'", () => {
				for (const rest of [[{ ts: 50, type: "ask", ask: "resume_task" } as AiHydroMessage], [errorRow], later()]) {
					const t = renderRow(ask, rest).container.textContent
					expect(t).toContain(`asked to ${noun}:`)
					expect(t).not.toContain(done)
				}
			})
			it("auto-run row (say): 'Running' until completion evidence, then past tense or 'Failed'", () => {
				const say: AiHydroMessage = { ts: 2, type: "say", say: "tool", text }
				const running = renderRow(say).container.textContent
				expect(running).toContain(`Running: ${noun}…`)
				expect(running).not.toContain(done)
				expect(renderRow({ ...say, execOutcome: "completed" }, later()).container.textContent).toContain(done)
				expect(renderRow({ ...say, execOutcome: "failed" }, later()).container.textContent).toContain(`Failed: ${noun}:`)
				expect(renderRow(say, [errorRow]).container.textContent).toContain(`Failed: ${noun}:`)
				// A recording from before completion was tracked: the turn advanced but nothing proves the result.
				const old = renderRow(say, later()).container.textContent
				expect(old).toContain(`asked to ${noun}:`)
				expect(old).not.toContain(done)
			})
		})
	}

	describe("command", () => {
		const ask: AiHydroMessage = { ts: 5, type: "ask", ask: "command", text: "ls" }
		it("pending / denied / approved / failed / executed", () => {
			expect(renderRow(ask).container.textContent).toContain("wants to execute this command:")
			expect(renderRow({ ...ask, askOutcome: "denied" }, later()).container.textContent).toContain(
				"Denied: execute this command (not run)",
			)
			const approved = renderRow({ ...ask, askOutcome: "approved" }, later()).container.textContent
			expect(approved).toContain("Approved: execute this command:")
			expect(approved).not.toContain("ran this command")
			expect(renderRow({ ...ask, askOutcome: "approved" }, [errorRow]).container.textContent).toContain(
				"Failed: execute this command:",
			)
			expect(
				renderRow({ ...ask, askOutcome: "approved", commandCompleted: true }, later()).container.textContent,
			).toContain("AI-Hydro ran this command:")
			expect(
				renderRow({ ...ask, askOutcome: "approved", execOutcome: "completed" }, later()).container.textContent,
			).toContain("AI-Hydro ran this command:")
		})
		it("command output is evidence it ran; an unanswered superseded ask is only 'asked to'", () => {
			const output: AiHydroMessage = { ts: 6, type: "say", say: "command_output", text: "ok" }
			expect(renderRow({ ...ask, askOutcome: "approved" }, [output]).container.textContent).toContain(
				"AI-Hydro ran this command:",
			)
			expect(renderRow(ask, later()).container.textContent).toContain("asked to execute this command:")
		})
		it("auto-run command row says Running until output or completion", () => {
			const say: AiHydroMessage = { ts: 5, type: "say", say: "command", text: "ls" }
			expect(renderRow(say).container.textContent).toContain("Running: execute this command…")
			expect(renderRow({ ...say, commandCompleted: true }).container.textContent).toContain("AI-Hydro ran this command:")
		})
	})

	describe("MCP tool", () => {
		const text = JSON.stringify({ type: "use_mcp_tool", serverName: "other", toolName: "t", arguments: "{}" })
		const ask: AiHydroMessage = { ts: 3, type: "ask", ask: "use_mcp_server", text }
		it("pending / denied / approved / executed / failed / unknown", () => {
			expect(renderRow(ask).container.textContent).toContain("wants to use a tool")
			const denied = renderRow({ ...ask, askOutcome: "denied" }, later()).container.textContent
			expect(denied).toContain("Denied: use a tool")
			expect(denied).toContain("(not run)")
			const approved = renderRow({ ...ask, askOutcome: "approved" }, later()).container.textContent
			expect(approved).toContain("Approved: use a tool")
			expect(approved).not.toContain("used a tool")
			const response: AiHydroMessage = { ts: 7, type: "say", say: "mcp_server_response", text: "fine" }
			expect(renderRow({ ...ask, askOutcome: "approved" }, [response]).container.textContent).toContain("used a tool")
			const failedResponse: AiHydroMessage = { ...response, text: "Error:\nbad input" }
			expect(renderRow({ ...ask, askOutcome: "approved" }, [failedResponse]).container.textContent).toContain(
				"Failed: use a tool",
			)
			const unknown = renderRow(ask, later()).container.textContent
			expect(unknown).toContain("asked to use a tool")
			expect(unknown).not.toContain("used a tool")
		})
		it("an auto-run say row reads Running, then past tense once the response arrives", () => {
			const say = { ...ask, type: "say", ask: undefined, say: "use_mcp_server" } as AiHydroMessage
			expect(renderRow(say).container.textContent).toContain("Running: use a tool")
			const response: AiHydroMessage = { ts: 7, type: "say", say: "mcp_server_response", text: "fine" }
			expect(renderRow(say, [response]).container.textContent).toContain("used a tool")
			const started: AiHydroMessage = { ts: 7, type: "say", say: "mcp_server_request_started" }
			expect(renderRow({ ...ask, askOutcome: "approved" }, [started]).container.textContent).toContain(
				"Running: use a tool",
			)
		})
	})

	describe("science card", () => {
		const text = JSON.stringify({ type: "use_mcp_tool", serverName: "ai-hydro", toolName: "describe_tool", arguments: "{}" })
		const ask: AiHydroMessage = { ts: 4, type: "ask", ask: "use_mcp_server", text }
		it("says nothing has run while pending, was not run once denied, and does not claim a result otherwise", () => {
			const pending = renderRow(ask).container.textContent
			expect(pending).toContain("Not run yet: waiting for your permission.")
			expect(pending).not.toContain("No result recorded yet.")
			expect(renderRow({ ...ask, askOutcome: "denied" }, later()).container.textContent).toContain(
				"Not run: you denied this call.",
			)
			expect(renderRow({ ...ask, askOutcome: "approved" }, later()).container.textContent).toContain(
				"Approved. No result recorded yet.",
			)
			expect(renderRow({ ...ask, askOutcome: "approved", execOutcome: "failed" }, later()).container.textContent).toContain(
				"Failed: no result was recorded.",
			)
		})
	})
})
