import { APPROVAL_ASKS } from "@shared/aihydro/askOutcome"
import { isInlineApprovalAsk } from "@shared/aihydro/pendingAsk"
import { type DetailLevel } from "@shared/aihydro/transcriptPresenter"
import type { AiHydroAsk, AiHydroMessage } from "@shared/ExtensionMessage"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fixtureMcpServers } from "@/screens/fixtures/aihydro"
import { ActionButtons } from "../chat-view/components/layout/ActionButtons"
import { createMessageRenderer } from "../chat-view/components/messages/MessageRenderer"
import { buildTranscriptView, filterVisibleMessages, groupMessages, processMessages } from "../chat-view/utils/messageUtils"
import { makeTranscriptResolvers } from "../transcript/resolvers"
import { TranscriptItemRenderer } from "../transcript/TranscriptItemRenderer"
import { PendingAskProvider } from "./PendingAskContext"

let state: Record<string, unknown> = {}
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mcpMarketplaceCatalog: { items: [] },
		onRelinquishControl: () => () => {},
		vscodeTerminalExecutionMode: "vscodeTerminal",
		setMcpServers: () => {},
		...state,
	}),
}))
vi.mock("@/context/HtmlPreviewContext", () => ({ useHtmlPreviewContext: () => ({ items: [] }) }))
vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {},
	TaskServiceClient: { askResponse: vi.fn() },
	UiServiceClient: {},
	McpServiceClient: {},
	CheckpointsServiceClient: {},
}))
vi.mock("../../../context/LedgerContext", () => ({ useLedgerContext: () => ({ getClaim: () => undefined }) }))

const task: AiHydroMessage = { ts: 1, type: "say", say: "task", text: "do the thing" }
const prose: AiHydroMessage = { ts: 2, type: "say", say: "text", text: "I will do it next." }

const askBody: Partial<Record<AiHydroAsk, string>> = {
	tool: JSON.stringify({ tool: "editedExistingFile", path: "a.py", diff: "x" }),
	command: "pytest -q",
	use_mcp_server: JSON.stringify({ serverName: "ai-hydro", type: "use_mcp_tool", toolName: "get_forcing", arguments: "{}" }),
	browser_action_launch: "http://localhost:3000",
	api_req_failed: "request failed",
	completion_result: "All done.",
	resume_task: "",
}

function mountTail(ask: AiHydroAsk, detail: DetailLevel) {
	const tail: AiHydroMessage = { ts: 100, type: "ask", ask, text: askBody[ask] }
	const messages = [task, prose, tail]
	state = {
		aihydroMessages: messages,
		mcpServers: fixtureMcpServers,
		autoApprovalSettings: { enabled: false, actions: {} },
		browserSettings: { viewport: { width: 900, height: 600 } },
	}
	const processed = processMessages(messages.slice(1))
	const visible = filterVisibleMessages(processed)
	const grouped = groupMessages(visible)
	const view = buildTranscriptView(processed, grouped, { detail, ...makeTranscriptResolvers(fixtureMcpServers, []) })
	const handlers = { executeButtonAction: vi.fn(), handleSendMessage: vi.fn() } as any
	const chatState = {
		inputValue: "",
		selectedImages: [],
		selectedFiles: [],
		setSendingDisabled: vi.fn(),
		setInputValue: vi.fn(),
		setSelectedImages: vi.fn(),
		setSelectedFiles: vi.fn(),
		textAreaRef: { current: null },
	} as any
	const ctx = {
		allMessages: processed,
		modifiedMessages: processed,
		expandedRows: {},
		onToggleExpand: () => {},
		onHeightChange: () => {},
		onSetQuote: () => {},
		inputValue: "",
		messageHandlers: handlers,
		groupExpanded: {},
		onToggleGroup: () => {},
		running: false,
	}
	const legacy = createMessageRenderer(
		grouped,
		processed,
		{},
		() => {},
		() => {},
		() => {},
		"",
		handlers,
	)
	const rows = view.entries.map((entry, i) =>
		entry.mode === "legacy" ? (
			<div key={entry.key}>{legacy(i, entry.entry)}</div>
		) : (
			<TranscriptItemRenderer
				auditMessage={entry.auditMessage}
				count={view.entries.length}
				ctx={ctx}
				index={i}
				item={entry.item}
				key={entry.key}
			/>
		),
	)
	return render(
		<PendingAskProvider chatState={chatState} messageHandlers={handlers}>
			{rows}
			<ActionButtons
				chatState={chatState}
				messageHandlers={handlers}
				messages={messages}
				mode="act"
				scrollBehavior={
					{
						scrollToBottomSmooth: vi.fn(),
						disableAutoScrollRef: { current: false },
						showScrollToBottom: false,
						virtuosoRef: { current: null },
					} as any
				}
				task={task}
			/>
		</PendingAskProvider>,
	)
}

beforeEach(() => {
	;(globalThis as any).ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
})

const LEVELS: DetailLevel[] = ["focus", "normal", "verbose"]

describe("approval asks are answered on their card at every detail level", () => {
	for (const ask of APPROVAL_ASKS) {
		for (const detail of LEVELS) {
			it(`${ask} at ${detail}: exactly one inline primary button, no footer actions`, () => {
				mountTail(ask, detail)
				expect(screen.getAllByTestId("inline-approval-primary")).toHaveLength(1)
				expect(screen.getAllByTestId("inline-approval")).toHaveLength(1)
				expect(screen.queryByTestId("footer-actions")).toBeNull()
				expect(screen.getAllByTestId("inline-approval-deny")).toHaveLength(1)
			})
		}
	}

	it("a pending browser launch renders a card body, not an empty row", () => {
		for (const detail of LEVELS) {
			const { unmount, container } = mountTail("browser_action_launch", detail)
			expect(container.textContent).toMatch(/launch a browser|use the browser/)
			unmount()
		}
	})
})

describe("asks that are not approvals keep the footer", () => {
	for (const ask of ["api_req_failed", "completion_result", "resume_task"] as const) {
		for (const detail of LEVELS) {
			it(`${ask} at ${detail}: footer actions present, no inline group`, () => {
				expect(isInlineApprovalAsk({ ts: 1, type: "ask", ask })).toBe(false)
				mountTail(ask, detail)
				expect(screen.getByTestId("footer-actions")).toBeTruthy()
				expect(screen.queryByTestId("inline-approval")).toBeNull()
			})
		}
	}
})
