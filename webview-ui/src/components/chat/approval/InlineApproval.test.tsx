import { AUTO_APPROVE_REFUSED_PREFIX, formatAutoApproveRefusal } from "@shared/aihydro/alwaysAllowPolicy"
import type { AiHydroMessage } from "@shared/ExtensionMessage"
import type { McpServer } from "@shared/mcp"
import { convertMcpServersToProtoMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { STALE_ASK_NOTICE } from "../chat-view/askBinding"
import { useMessageHandlers } from "../chat-view/hooks/useMessageHandlers"
import { InlineApproval } from "./InlineApproval"
import { PendingAskProvider } from "./PendingAskContext"

const toggle = vi.fn()
const askResponse = vi.fn()
let state: Record<string, unknown> = {}
const setMcpServers = vi.fn()

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ ...state, setMcpServers }),
}))
vi.mock("@/services/grpc-client", () => ({
	McpServiceClient: { toggleToolAutoApprove: (...a: unknown[]) => toggle(...a) },
	TaskServiceClient: { askResponse: (...a: unknown[]) => askResponse(...a) },
	SlashServiceClient: {},
}))

const SERVER = "stub"
const tool = (
	name: string,
	annotations?: McpServer["tools"] extends (infer T)[] | undefined ? any : never,
	autoApprove?: boolean,
) => ({
	name,
	description: "fixture",
	annotations,
	autoApprove,
})
const server = (
	over: Partial<McpServer> = {},
	tools = [tool("read_tool", { readOnlyHint: true, openWorldHint: false })],
): McpServer => ({
	name: SERVER,
	config: "{}",
	status: "connected",
	trust: { trusted: true, reason: "fixture" },
	tools,
	...over,
})

const taskRow: AiHydroMessage = { ts: 1, type: "say", say: "task", text: "go" }
const mcpAsk = (extra: Partial<AiHydroMessage> = {}, toolName = "read_tool", type = "use_mcp_tool"): AiHydroMessage => ({
	ts: 100,
	type: "ask",
	ask: "use_mcp_server",
	text: JSON.stringify({
		serverName: SERVER,
		type,
		toolName,
		uri: type === "access_mcp_resource" ? "x://y" : undefined,
		arguments: "{}",
	}),
	...extra,
})
const commandAsk: AiHydroMessage = { ts: 100, type: "ask", ask: "command", text: "ls -la" }
const editAsk: AiHydroMessage = {
	ts: 100,
	type: "ask",
	ask: "tool",
	text: JSON.stringify({ tool: "editedExistingFile", path: "a.py", diff: "x" }),
}
const browserAsk: AiHydroMessage = { ts: 100, type: "ask", ask: "browser_action_launch", text: "http://localhost:3000" }

interface Setup {
	message: AiHydroMessage
	rest?: AiHydroMessage[]
	servers?: McpServer[]
	draft?: string
	autoRun?: { enabled: boolean; actions: Record<string, boolean> }
}

const executeButtonAction = vi.fn(async (..._a: unknown[]) => {})
const textArea = document.createElement("textarea")

function mount({ message, rest = [], servers = [server()], draft = "", autoRun }: Setup) {
	state = {
		mcpServers: servers,
		aihydroMessages: [taskRow, message, ...rest],
		autoApprovalSettings: autoRun ?? { enabled: true, actions: { useMcp: true } },
		yoloModeToggled: false,
	}
	const chatState = {
		inputValue: draft,
		selectedImages: [],
		selectedFiles: [],
		askNotice: undefined as string | undefined,
		textAreaRef: { current: textArea },
	}
	const tree = (m: AiHydroMessage, notice?: string) => (
		<PendingAskProvider
			chatState={{ ...chatState, askNotice: notice } as any}
			messageHandlers={{ executeButtonAction } as any}>
			<InlineApproval message={m} />
		</PendingAskProvider>
	)
	const view = render(tree(message))
	return {
		...view,
		rerenderWith: (m: AiHydroMessage, notice?: string) => {
			// A new message list, as a state post delivers it.
			state = { ...state, aihydroMessages: [taskRow, m, ...rest] }
			view.rerender(tree(m, notice))
		},
	}
}

beforeEach(() => {
	toggle.mockReset()
	askResponse.mockReset()
	askResponse.mockResolvedValue({})
	executeButtonAction.mockClear()
	executeButtonAction.mockResolvedValue(undefined)
	setMcpServers.mockReset()
	document.body.appendChild(textArea)
})

const group = () => screen.queryByTestId("inline-approval")
const always = () => screen.queryByTestId("inline-approval-always")

/** The host's reply to toggleToolAutoApprove: the settings as they now are, with `trusted` as the host would report. */
function protoReply(servers: McpServer[], trusted = true) {
	return { mcpServers: convertMcpServersToProtoMcpServers(servers).map((s) => ({ ...s, trusted })) }
}

describe("InlineApproval visibility", () => {
	it("shows Run and Deny on a pending approval at the tail", () => {
		mount({ message: commandAsk })
		expect(group()).toBeTruthy()
		expect(screen.getByRole("button", { name: "Run Command" })).toBeTruthy()
		expect(screen.getByRole("button", { name: "Deny" })).toBeTruthy()
		expect(screen.getAllByTestId("inline-approval-primary")).toHaveLength(1)
	})

	it("uses Save for an edit and Run for MCP and browser launch (labels come from buttonConfig)", () => {
		mount({ message: editAsk })
		expect(screen.getByRole("button", { name: "Save" })).toBeTruthy()
	})

	it("shows nothing while the ask is still streaming (partial)", () => {
		mount({ message: { ...commandAsk, partial: true } })
		expect(group()).toBeNull()
	})

	it("shows nothing once the ask is answered", () => {
		mount({ message: { ...commandAsk, askOutcome: "approved" } })
		expect(group()).toBeNull()
	})

	it("shows nothing when a later row exists (superseded or answered)", () => {
		mount({ message: commandAsk, rest: [{ ts: 200, type: "say", say: "text", text: "next" }] })
		expect(group()).toBeNull()
	})

	it("shows nothing for asks that keep their footer buttons", () => {
		for (const ask of ["api_req_failed", "completion_result", "resume_task", "followup", "command_output"] as const) {
			const { unmount } = mount({ message: { ts: 100, type: "ask", ask, text: "x" } })
			expect(group()).toBeNull()
			unmount()
		}
	})
})

describe("InlineApproval answers", () => {
	it("Run and Deny call executeButtonAction with the draft and the card's own ts", async () => {
		mount({ message: commandAsk, draft: "use -a" })
		fireEvent.click(screen.getByRole("button", { name: "Run Command" }))
		await waitFor(() => expect(executeButtonAction).toHaveBeenCalledTimes(1))
		expect(executeButtonAction).toHaveBeenCalledWith("approve", "use -a", [], [], 100)
	})

	it("Deny rejects with the draft and the card's ts", async () => {
		mount({ message: mcpAsk(), draft: "not that one" })
		fireEvent.click(screen.getByRole("button", { name: "Deny" }))
		await waitFor(() => expect(executeButtonAction).toHaveBeenCalledWith("reject", "not that one", [], [], 100))
	})

	it("Save sends approve for an edit", async () => {
		mount({ message: editAsk })
		fireEvent.click(screen.getByRole("button", { name: "Save" }))
		await waitFor(() => expect(executeButtonAction).toHaveBeenCalledWith("approve", "", [], [], 100))
	})

	it("a rejected answer shows a visible note and leaves no unhandled rejection", async () => {
		executeButtonAction.mockRejectedValue(new Error("network"))
		const unhandled = vi.fn()
		process.on("unhandledRejection", unhandled)
		mount({ message: commandAsk })
		fireEvent.click(screen.getByRole("button", { name: "Run Command" }))
		const note = await screen.findByTestId("inline-approval-note")
		expect(note.textContent).toContain("not sent")
		await new Promise((r) => setTimeout(r, 20))
		process.off("unhandledRejection", unhandled)
		expect(unhandled).not.toHaveBeenCalled()
		expect((screen.getByRole("button", { name: "Run Command" }) as HTMLButtonElement).disabled).toBe(false)
	})

	it("says the draft is sent with the choice, only when there is a draft", () => {
		const a = mount({ message: commandAsk, draft: "" })
		expect(screen.queryByTestId("inline-approval-draft-hint")).toBeNull()
		a.unmount()
		mount({ message: commandAsk, draft: "note" })
		expect(screen.getByTestId("inline-approval-draft-hint").textContent).toBe("Your draft will be sent with your choice.")
		expect(group()?.getAttribute("aria-describedby")).toContain(screen.getByTestId("inline-approval-draft-hint").id)
	})

	it("the shared guard stops a double submit", async () => {
		let release: () => void = () => {}
		executeButtonAction.mockImplementation(() => new Promise<void>((r) => (release = r)))
		mount({ message: commandAsk })
		const run = screen.getByRole("button", { name: "Run Command" })
		fireEvent.click(run)
		fireEvent.click(run)
		fireEvent.click(screen.getByRole("button", { name: "Deny" }))
		expect(executeButtonAction).toHaveBeenCalledTimes(1)
		release()
	})

	it("moves focus to the composer when the group it was in is answered away", async () => {
		const view = mount({ message: commandAsk })
		const run = screen.getByRole("button", { name: "Run Command" })
		run.focus()
		expect(document.activeElement).toBe(run)
		fireEvent.click(run)
		await waitFor(() => expect(executeButtonAction).toHaveBeenCalled())
		view.rerenderWith({ ...commandAsk, askOutcome: "approved" })
		expect(group()).toBeNull()
		expect(document.activeElement).toBe(textArea)
	})

	it("leaves focus alone when focus was elsewhere", async () => {
		const outside = document.createElement("button")
		document.body.appendChild(outside)
		const view = mount({ message: commandAsk })
		outside.focus()
		// Programmatic click does not move focus; the group never held it.
		fireEvent.click(screen.getByRole("button", { name: "Run Command" }))
		await waitFor(() => expect(executeButtonAction).toHaveBeenCalled())
		view.rerenderWith({ ...commandAsk, askOutcome: "approved" })
		expect(document.activeElement).toBe(outside)
	})

	it("shows the stale notice next to the card", () => {
		const view = mount({ message: commandAsk })
		view.rerenderWith(commandAsk, STALE_ASK_NOTICE)
		expect(screen.getByTestId("inline-approval-stale").textContent).toBe(STALE_ASK_NOTICE)
	})

	it("registers no window or document keydown listener", async () => {
		const w = vi.spyOn(window, "addEventListener")
		const d = vi.spyOn(document, "addEventListener")
		mount({ message: mcpAsk() })
		fireEvent.click(screen.getByRole("button", { name: "Deny" }))
		await waitFor(() => expect(executeButtonAction).toHaveBeenCalled())
		for (const spy of [w, d]) {
			expect(spy.mock.calls.filter(([type]) => String(type).startsWith("key"))).toEqual([])
		}
		w.mockRestore()
		d.mockRestore()
	})

	it("has no key handlers on the group or its buttons", () => {
		mount({ message: mcpAsk() })
		const g = group() as HTMLElement
		expect(g.getAttribute("tabindex")).toBe("-1")
		expect(g.getAttribute("role")).toBe("group")
		expect(g.getAttribute("aria-label")).toMatch(/^Approval needed:/)
	})
})

describe("InlineApproval Always eligibility", () => {
	const annotated = (name: string, annotations: any, autoApprove?: boolean) => [tool(name, annotations, autoApprove)]

	it("is offered for a trusted, connected tool with a READ effect", () => {
		mount({ message: mcpAsk() })
		expect(always()?.textContent).toBe("Always")
		expect(always()?.getAttribute("aria-label")).toBe("Always run read_tool on stub")
	})

	it("is offered for a WRITE tool", () => {
		mount({
			message: mcpAsk({}, "w"),
			servers: [server({}, annotated("w", { readOnlyHint: false, destructiveHint: false, openWorldHint: false }))],
		})
		expect(always()).toBeTruthy()
	})

	const hidden: [string, Setup][] = [
		["DESTRUCTIVE", { message: mcpAsk({}, "d"), servers: [server({}, annotated("d", { destructiveHint: true }))] }],
		["UNKNOWN (no annotations)", { message: mcpAsk({}, "u"), servers: [server({}, annotated("u", undefined))] }],
		["an untrusted server", { message: mcpAsk(), servers: [server({ trust: { trusted: false, reason: "no" } })] }],
		["a server with no trust verdict", { message: mcpAsk(), servers: [server({ trust: undefined })] }],
		["a disconnected server", { message: mcpAsk(), servers: [server({ status: "disconnected" })] }],
		["an unlisted tool", { message: mcpAsk({}, "ghost") }],
		[
			"a tool already auto-approved",
			{ message: mcpAsk({}, "a"), servers: [server({}, annotated("a", { readOnlyHint: true }, true))] },
		],
		["resource access", { message: mcpAsk({}, "read_tool", "access_mcp_resource") }],
		["a policyClass stamp", { message: mcpAsk({ policyClass: "protected_path" } as any) }],
		["an outside-workspace stamp", { message: mcpAsk({ isOperationOutsideWorkspace: true }) }],
		["a native tool", { message: editAsk }],
		["a command", { message: commandAsk }],
		["a browser launch", { message: browserAsk }],
	]
	it.each(hidden)("is hidden for %s", (_name, setup) => {
		mount(setup)
		expect(group()).toBeTruthy()
		expect(always()).toBeNull()
	})
})

describe("InlineApproval Always flow", () => {
	it("saves the grant, checks the reply, and only then approves with the card's ts and the draft", async () => {
		let resolveToggle: (v: unknown) => void = () => {}
		toggle.mockImplementation(() => new Promise((r) => (resolveToggle = r)))
		mount({ message: mcpAsk(), draft: "go ahead" })
		fireEvent.click(always() as HTMLElement)
		await waitFor(() => expect(toggle).toHaveBeenCalledTimes(1))
		expect(toggle.mock.calls[0][0]).toMatchObject({ serverName: "stub", toolNames: ["read_tool"], autoApprove: true })
		// Not approved while the grant is still being saved.
		expect(executeButtonAction).not.toHaveBeenCalled()
		await act(async () =>
			resolveToggle(protoReply([server({}, [tool("read_tool", { readOnlyHint: true, openWorldHint: false }, true)])])),
		)
		await waitFor(() => expect(executeButtonAction).toHaveBeenCalledTimes(1))
		expect(executeButtonAction).toHaveBeenCalledWith("approve", "go ahead", [], [], 100)
		expect(setMcpServers).toHaveBeenCalled()
	})

	it("a host refusal approves nothing and shows the reason inline", async () => {
		toggle.mockRejectedValue(
			new Error(formatAutoApproveRefusal({ server: "stub", refused: [{ tool: "read_tool", reason: "unknown_effect" }] })),
		)
		mount({ message: mcpAsk() })
		fireEvent.click(always() as HTMLElement)
		const note = await screen.findByTestId("inline-approval-note")
		expect(note.textContent).toContain("effect not declared")
		expect(note.textContent).toContain("Nothing was changed")
		expect(note.getAttribute("role")).toBe("alert")
		expect(group()?.getAttribute("aria-describedby")).toContain(note.id)
		expect(executeButtonAction).not.toHaveBeenCalled()
		// Run and Deny remain, and the buttons are usable again.
		expect(screen.getByRole("button", { name: "Run" })).toBeTruthy()
		expect((always() as HTMLButtonElement).disabled).toBe(false)
	})

	it("a reply that does not show the tool marked is 'Not saved' and approves nothing", async () => {
		toggle.mockResolvedValue(protoReply([server()]))
		mount({ message: mcpAsk() })
		fireEvent.click(always() as HTMLElement)
		const note = await screen.findByTestId("inline-approval-note")
		expect(note.textContent).toMatch(/^Not saved/)
		expect(executeButtonAction).not.toHaveBeenCalled()
	})

	it("an unparseable failure approves nothing and says so", async () => {
		toggle.mockRejectedValue(new Error("boom"))
		mount({ message: mcpAsk() })
		fireEvent.click(always() as HTMLElement)
		const note = await screen.findByTestId("inline-approval-note")
		expect(note.textContent).toContain("Nothing was approved")
		expect(executeButtonAction).not.toHaveBeenCalled()
	})

	it("a wrapper-prefixed refusal is still parsed", async () => {
		toggle.mockRejectedValue(
			new Error(
				`gRPC failed: ${AUTO_APPROVE_REFUSED_PREFIX}${JSON.stringify({ server: "stub", refused: [{ tool: "read_tool", reason: "untrusted_server" }] })}`,
			),
		)
		mount({ message: mcpAsk() })
		fireEvent.click(always() as HTMLElement)
		const note = await screen.findByTestId("inline-approval-note")
		expect(note.textContent).toContain("not the registered first-party server")
	})

	it("a saved grant puts no success line on the card (it is shown in the footer, which survives folding)", async () => {
		toggle.mockResolvedValue(
			protoReply([server({}, [tool("read_tool", { readOnlyHint: true, openWorldHint: false }, true)])]),
		)
		mount({ message: mcpAsk() })
		fireEvent.click(always() as HTMLElement)
		await waitFor(() => expect(executeButtonAction).toHaveBeenCalled())
		expect(screen.queryByTestId("inline-approval-note")).toBeNull()
	})

	it("the grant saved but the approval failed to send: says so, not 'could not save'", async () => {
		toggle.mockResolvedValue(
			protoReply([server({}, [tool("read_tool", { readOnlyHint: true, openWorldHint: false }, true)])]),
		)
		executeButtonAction.mockRejectedValue(new Error("network"))
		mount({ message: mcpAsk() })
		fireEvent.click(always() as HTMLElement)
		const note = await screen.findByTestId("inline-approval-note")
		expect(note.textContent).toBe("Always was saved, but the approval was not sent — press Run.")
		expect(note.textContent).not.toContain("Could not save")
		expect((screen.getByRole("button", { name: "Run" }) as HTMLButtonElement).disabled).toBe(false)
	})

	it("a double click saves once", async () => {
		toggle.mockImplementation(() => new Promise(() => {}))
		mount({ message: mcpAsk() })
		fireEvent.click(always() as HTMLElement)
		fireEvent.click(always() as HTMLElement)
		fireEvent.click(screen.getByRole("button", { name: "Run" }))
		expect(toggle).toHaveBeenCalledTimes(1)
		expect(executeButtonAction).not.toHaveBeenCalled()
	})
})

describe("InlineApproval Always when MCP auto-run is off", () => {
	it("says so in visible text and ties it to the button with aria-describedby", () => {
		mount({ message: mcpAsk(), autoRun: { enabled: true, actions: { useMcp: false } } })
		const text = screen.getByTestId("inline-approval-inactive")
		expect(text.textContent).toBe("Always is inactive while MCP auto-run is off")
		expect(always()?.getAttribute("aria-describedby")).toBe(text.id)
		// Still offered: it never turns MCP auto-run on as a side effect.
		expect(always()).toBeTruthy()
	})

	it("uses the W2-D wording when auto-run itself is off", () => {
		mount({ message: mcpAsk(), autoRun: { enabled: false, actions: { useMcp: true } } })
		expect(screen.getByTestId("inline-approval-inactive").textContent).toBe("Always is inactive while auto-run is off")
	})

	it("says nothing when the grant would be active", () => {
		mount({ message: mcpAsk() })
		expect(screen.queryByTestId("inline-approval-inactive")).toBeNull()
		expect(always()?.getAttribute("aria-describedby")).toBeNull()
	})
})

describe("inline answers reach the host bound to the card's own ts", () => {
	function Wrapper({ children, messages }: { children: ReactNode; messages: AiHydroMessage[] }) {
		const chatState = {
			inputValue: "",
			selectedImages: [],
			selectedFiles: [],
			lastMessage: messages.at(-1),
			aihydroAsk: undefined,
			setAskNotice: vi.fn(),
			setInputValue: vi.fn(),
			setActiveQuote: vi.fn(),
			setSelectedImages: vi.fn(),
			setSelectedFiles: vi.fn(),
			setSendingDisabled: vi.fn(),
			setEnableButtons: vi.fn(),
			textAreaRef: { current: null },
		} as any
		const handlers = useMessageHandlers(messages, chatState)
		return (
			<PendingAskProvider chatState={chatState} messageHandlers={handlers}>
				{children}
			</PendingAskProvider>
		)
	}

	it("sends the card's ts, not the last message's", async () => {
		state = {
			mcpServers: [server()],
			aihydroMessages: [],
			autoApprovalSettings: { enabled: false, actions: {} },
			backgroundCommandRunning: false,
		}
		// The card is ask 100; the stream has since moved to ask 300.
		const messages = [taskRow, commandAsk, { ts: 300, type: "ask", ask: "command", text: "other" } as AiHydroMessage]
		state.aihydroMessages = [taskRow, commandAsk]
		render(
			<Wrapper messages={messages}>
				<InlineApproval message={commandAsk} />
			</Wrapper>,
		)
		fireEvent.click(screen.getByRole("button", { name: "Run Command" }))
		await waitFor(() => expect(askResponse).toHaveBeenCalledTimes(1))
		expect(askResponse.mock.calls[0][0]).toMatchObject({ responseType: "yesButtonClicked", askTs: 100 })
	})

	it("an ask superseded while the Always grant was being saved: the approval still names the card and is dropped as stale", async () => {
		askResponse.mockResolvedValue({ stale: true })
		let resolveToggle: (v: unknown) => void = () => {}
		toggle.mockImplementation(() => new Promise((r) => (resolveToggle = r)))
		const call = mcpAsk()
		state = {
			mcpServers: [server()],
			aihydroMessages: [taskRow, call],
			autoApprovalSettings: { enabled: true, actions: { useMcp: true } },
		}
		const setAskNotice = vi.fn()
		// By the time the toggle resolves the stream has moved on to ask 300.
		const messages = [taskRow, call, { ts: 300, type: "ask", ask: "command", text: "rm -rf build" } as AiHydroMessage]
		function W({ children }: { children: ReactNode }) {
			const chatState = {
				inputValue: "",
				selectedImages: [],
				selectedFiles: [],
				lastMessage: messages.at(-1),
				setAskNotice,
				setInputValue: vi.fn(),
				setActiveQuote: vi.fn(),
				setSelectedImages: vi.fn(),
				setSelectedFiles: vi.fn(),
				setSendingDisabled: vi.fn(),
				setEnableButtons: vi.fn(),
				textAreaRef: { current: null },
			} as any
			const handlers = useMessageHandlers(messages, chatState)
			return (
				<PendingAskProvider chatState={chatState} messageHandlers={handlers}>
					{children}
				</PendingAskProvider>
			)
		}
		render(
			<W>
				<InlineApproval message={call} />
			</W>,
		)
		fireEvent.click(always() as HTMLElement)
		await waitFor(() => expect(toggle).toHaveBeenCalled())
		await act(async () =>
			resolveToggle(protoReply([server({}, [tool("read_tool", { readOnlyHint: true, openWorldHint: false }, true)])])),
		)
		await waitFor(() => expect(askResponse).toHaveBeenCalledTimes(1))
		expect(askResponse.mock.calls[0][0]).toMatchObject({ responseType: "yesButtonClicked", askTs: 100 })
		await waitFor(() => expect(setAskNotice).toHaveBeenCalledWith(STALE_ASK_NOTICE))
	})

	it("a stale answer (the ask changed) shows the notice through the shared path and frees the buttons", async () => {
		askResponse.mockResolvedValue({ stale: true })
		state = {
			mcpServers: [server()],
			aihydroMessages: [taskRow, commandAsk],
			autoApprovalSettings: { enabled: false, actions: {} },
		}
		const setAskNotice = vi.fn()
		function W({ children }: { children: ReactNode }) {
			const chatState = {
				inputValue: "",
				selectedImages: [],
				selectedFiles: [],
				lastMessage: commandAsk,
				setAskNotice,
				setInputValue: vi.fn(),
				setActiveQuote: vi.fn(),
				setSelectedImages: vi.fn(),
				setSelectedFiles: vi.fn(),
				setSendingDisabled: vi.fn(),
				setEnableButtons: vi.fn(),
				textAreaRef: { current: null },
			} as any
			const handlers = useMessageHandlers([taskRow, commandAsk], chatState)
			return (
				<PendingAskProvider chatState={chatState} messageHandlers={handlers}>
					{children}
				</PendingAskProvider>
			)
		}
		render(
			<W>
				<InlineApproval message={commandAsk} />
			</W>,
		)
		fireEvent.click(screen.getByRole("button", { name: "Run Command" }))
		await waitFor(() => expect(setAskNotice).toHaveBeenCalledWith(STALE_ASK_NOTICE))
	})
})
