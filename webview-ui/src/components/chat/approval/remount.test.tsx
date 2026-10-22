import type { DetailLevel } from "@shared/aihydro/transcriptPresenter"
import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { convertMcpServersToProtoMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fixtureMcpServers } from "@/screens/fixtures/aihydro"
import { ActionButtons } from "../chat-view/components/layout/ActionButtons"
import { createMessageRenderer } from "../chat-view/components/messages/MessageRenderer"
import { buildTranscriptView, filterVisibleMessages, groupMessages, processMessages } from "../chat-view/utils/messageUtils"
import { makeTranscriptResolvers } from "../transcript/resolvers"
import { TranscriptItemRenderer } from "../transcript/TranscriptItemRenderer"
import { PendingAskProvider } from "./PendingAskContext"

/**
 * The answered row leaves the pending slot: at Focus and Normal it folds into a work group, so its row remounts and
 * anything the card held in its own state or effects is gone. Focus restore and the "Always" revoke line must
 * survive that, so these tests drive the real TranscriptItemRenderer / MessageRenderer path, not a lone card.
 */
const toggle = vi.fn()
const executeButtonAction = vi.fn(async (..._a: unknown[]) => {})
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
	McpServiceClient: { toggleToolAutoApprove: (...a: unknown[]) => toggle(...a) },
	CheckpointsServiceClient: {},
}))
vi.mock("../../../context/LedgerContext", () => ({ useLedgerContext: () => ({ getClaim: () => undefined }) }))

const task: AiHydroMessage = { ts: 1, type: "say", say: "task", text: "go" }
const prose: AiHydroMessage = { ts: 2, type: "say", say: "text", text: "I will call the tool." }
const call = JSON.stringify({ serverName: "ai-hydro", type: "use_mcp_tool", toolName: "get_forcing", arguments: "{}" })
const pending: AiHydroMessage[] = [task, prose, { ts: 100, type: "ask", ask: "use_mcp_server", text: call }]
const answered: AiHydroMessage[] = [
	task,
	prose,
	{ ts: 100, type: "ask", ask: "use_mcp_server", text: call, askOutcome: "approved" },
	{ ts: 110, type: "say", say: "mcp_server_request_started" },
	{ ts: 120, type: "say", say: "mcp_server_response", text: "{}" },
	{ ts: 130, type: "say", say: "text", text: "All finished." },
]

let textArea: HTMLTextAreaElement

function Tree({ messages, detail }: { messages: AiHydroMessage[]; detail: DetailLevel }) {
	const processed = processMessages(messages.slice(1))
	const grouped = groupMessages(filterVisibleMessages(processed))
	const view = buildTranscriptView(processed, grouped, { detail, ...makeTranscriptResolvers(fixtureMcpServers, []) })
	const handlers = { executeButtonAction, handleSendMessage: vi.fn() } as any
	const chatState = {
		inputValue: "",
		selectedImages: [],
		selectedFiles: [],
		setSendingDisabled: vi.fn(),
		setInputValue: vi.fn(),
		setSelectedImages: vi.fn(),
		setSelectedFiles: vi.fn(),
		textAreaRef: { current: textArea },
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
	return (
		<PendingAskProvider chatState={chatState} messageHandlers={handlers}>
			{view.entries.map((entry, i) =>
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
			)}
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
						isAtBottom: true,
						virtuosoRef: { current: null },
					} as any
				}
				task={task}
			/>
		</PendingAskProvider>
	)
}

function setMessages(messages: AiHydroMessage[]) {
	state = {
		mcpServers: fixtureMcpServers,
		aihydroMessages: messages,
		autoApprovalSettings: { enabled: true, actions: { useMcp: true } },
		browserSettings: { viewport: { width: 900, height: 600 } },
	}
}

beforeEach(() => {
	document.body.innerHTML = ""
	textArea = document.createElement("textarea")
	document.body.appendChild(textArea)
	toggle.mockReset()
	executeButtonAction.mockClear()
	;(globalThis as any).ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
})

const LEVELS: DetailLevel[] = ["focus", "normal", "verbose"]
const grantedReply = () => ({
	mcpServers: convertMcpServersToProtoMcpServers(
		fixtureMcpServers.map((s) => ({
			...s,
			tools: s.tools?.map((t) => (t.name === "get_forcing" ? { ...t, autoApprove: true } : t)),
		})),
	).map((s) => ({ ...s, trusted: true })),
})

describe("answered row remounts: what the user needs survives", () => {
	for (const detail of LEVELS) {
		it(`${detail}: after Run, focus that was in the group lands on the composer, not <body>`, async () => {
			setMessages(pending)
			const view = render(<Tree detail={detail} messages={pending} />)
			const run = screen.getByTestId("inline-approval-primary")
			run.focus()
			expect(document.activeElement).toBe(run)
			fireEvent.click(run)
			await waitFor(() => expect(executeButtonAction).toHaveBeenCalledTimes(1))
			setMessages(answered)
			view.rerender(<Tree detail={detail} messages={answered} />)
			expect(screen.queryByTestId("inline-approval")).toBeNull()
			expect(document.activeElement).toBe(textArea)
		})

		it(`${detail}: focus that was elsewhere is left alone`, async () => {
			const other = document.createElement("button")
			document.body.appendChild(other)
			setMessages(pending)
			const view = render(<Tree detail={detail} messages={pending} />)
			other.focus()
			fireEvent.click(screen.getByTestId("inline-approval-primary"))
			await waitFor(() => expect(executeButtonAction).toHaveBeenCalledTimes(1))
			setMessages(answered)
			view.rerender(<Tree detail={detail} messages={answered} />)
			expect(document.activeElement).toBe(other)
		})

		it(`${detail}: after Always, the revoke line is still on screen once the card is gone, and focus is restored`, async () => {
			toggle.mockResolvedValue(grantedReply())
			setMessages(pending)
			const view = render(<Tree detail={detail} messages={pending} />)
			const always = screen.getByTestId("inline-approval-always")
			always.focus()
			fireEvent.click(always)
			await waitFor(() => expect(executeButtonAction).toHaveBeenCalledTimes(1))
			setMessages(answered)
			view.rerender(<Tree detail={detail} messages={answered} />)
			expect(screen.queryByTestId("inline-approval")).toBeNull()
			// The premise: at Focus and Normal the answered call has folded into a work group (its row remounted).
			expect(!!screen.queryByTestId("work-group")).toBe(detail !== "verbose")
			const note = screen.getByTestId("grant-note")
			expect(note.textContent).toContain("Always allowed get_forcing")
			expect(note.textContent).toContain("Revoke it any time in MCP settings.")
			expect(document.activeElement).toBe(textArea)
			// Dismissible.
			fireEvent.click(screen.getByRole("button", { name: "Dismiss note" }))
			expect(screen.queryByTestId("grant-note")).toBeNull()
		})
	}
})
