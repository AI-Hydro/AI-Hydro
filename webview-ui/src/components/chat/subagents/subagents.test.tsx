import type { SubagentChildSummary, SubagentLaunch } from "@shared/aihydro/subagents"
import type { AiHydroMessage } from "@shared/ExtensionMessage"
import type { McpServer } from "@shared/mcp"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { InlineApproval } from "../approval/InlineApproval"
import { PendingAskProvider } from "../approval/PendingAskContext"
import { isTaskRunning } from "../chat-view/shared/buttonConfig"
import { SubagentLaunchCard } from "./SubagentLaunchCard"
import { SubagentOriginChip } from "./SubagentOriginChip"
import { SubagentStatusRow } from "./SubagentStatusRow"
import { statusLabel, usageLine } from "./subagentText"

let state: Record<string, unknown> = {}
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ ...state, setMcpServers: vi.fn() }),
}))
vi.mock("@/services/grpc-client", () => ({
	McpServiceClient: { toggleToolAutoApprove: vi.fn() },
	TaskServiceClient: { askResponse: vi.fn() },
	SlashServiceClient: {},
}))

const origin = { childId: "sa_2", label: "Explorer 2", profile: "explorer" as const, promptHead: "Survey the repo for NSE" }
const child = (over: Partial<SubagentChildSummary> = {}): SubagentChildSummary => ({
	childId: "sa_1",
	label: "Explorer 1",
	profile: "explorer",
	promptHead: "What does model.py do?",
	status: "running",
	toolCalls: 3,
	tokensIn: 1200,
	tokensOut: 300,
	cacheWrites: 0,
	cacheReads: 0,
	calls: [],
	...over,
})
const row = (children: SubagentChildSummary[], done = false): AiHydroMessage => ({
	ts: 10,
	type: "say",
	say: "subagent_status",
	text: JSON.stringify({ profile: "explorer", done, children }),
})

describe("SubagentStatusRow", () => {
	it("lists each explorer with its state, last tool and usage", () => {
		render(
			<SubagentStatusRow
				message={row([
					child({ lastTool: "read_file" }),
					child({ childId: "sa_2", label: "Explorer 2", status: "queued", toolCalls: 0, tokensIn: 0, tokensOut: 0 }),
					child({ childId: "sa_3", label: "Explorer 3", status: "waiting" }),
				])}
			/>,
		)
		expect(screen.getByText("Explorer 1")).toBeTruthy()
		expect(screen.getByText("Queued")).toBeTruthy()
		expect(screen.getByText("Waiting for you")).toBeTruthy()
		expect(screen.getByText("read_file")).toBeTruthy()
		expect(screen.getAllByTestId("subagent-child")).toHaveLength(3)
		expect(screen.getAllByText(/3 calls · 1k tokens/).length).toBeGreaterThan(0)
	})

	it("says why a partial child stopped, and reads cancelled and failed plainly", () => {
		expect(statusLabel({ status: "partial", budgetStop: "wall_clock" })).toBe("Stopped early: out of time")
		expect(statusLabel({ status: "partial", budgetStop: "tool_calls" })).toBe("Stopped early: tool-call budget used")
		expect(statusLabel({ status: "cancelled" })).toBe("Cancelled")
		expect(statusLabel({ status: "failed" })).toBe("Failed")
		expect(statusLabel({ status: "blocked" })).toContain("refused")
	})

	it("never shows a cost the provider did not report", () => {
		expect(usageLine(child({ cost: undefined }))).not.toContain("$")
		expect(usageLine(child({ cost: 0 }))).not.toContain("$")
		expect(usageLine(child({ cost: 0.0123 }))).toContain("$0.0123")
	})

	it("expands to the calls and how each ended, without arguments", () => {
		render(
			<SubagentStatusRow
				message={row([
					child({
						status: "completed",
						recordPath: "subagents/sa_1.json",
						calls: [
							{ name: "read_file", approval: "auto", result: "ok" },
							{ name: "write_to_file", approval: "refused", result: "refused" },
							{ name: "use_mcp_tool", tool: "get_session_summary", approval: "approved", result: "ok" },
						],
					}),
				])}
			/>,
		)
		const toggle = screen.getByRole("button", { name: /Explorer 1/ })
		expect(toggle.getAttribute("aria-expanded")).toBe("false")
		expect(screen.queryByTestId("subagent-calls")).toBeNull()
		fireEvent.click(toggle)
		expect(toggle.getAttribute("aria-expanded")).toBe("true")
		const calls = screen.getByTestId("subagent-calls")
		expect(calls.textContent).toContain("write_to_file (refused)")
		expect(calls.textContent).toContain("get_session_summary")
		expect(screen.getByText(/subagents\/sa_1\.json/)).toBeTruthy()
	})

	it("shows nothing for a malformed row", () => {
		const { container } = render(
			<SubagentStatusRow message={{ ts: 1, type: "say", say: "subagent_status", text: "{oops" }} />,
		)
		expect(container.firstChild).toBeNull()
	})

	it("an unfinished row followed by a resume is shown as interrupted, not as still running", () => {
		state = { aihydroMessages: [row([child({ status: "running" })]), { ts: 99, type: "ask", ask: "resume_task" }] }
		render(
			<SubagentStatusRow
				message={row([
					child({ status: "running", lastTool: "read_file" }),
					child({ childId: "sa_2", label: "Explorer 2", status: "completed" }),
				])}
			/>,
		)
		expect(screen.getByText(/Interrupted: the task was closed/)).toBeTruthy()
		expect(screen.getByText(/interrupted/)).toBeTruthy()
		expect(screen.queryByText("read_file")).toBeNull()
		expect(screen.getByText("Done")).toBeTruthy() // a finished explorer keeps its ending
		state = {}
	})

	it("says it is finished once every explorer has ended", () => {
		render(<SubagentStatusRow message={row([child({ status: "completed" })], true)} />)
		expect(screen.getByText(/finished/)).toBeTruthy()
	})
})

describe("SubagentOriginChip", () => {
	it("names the explorer and what it is doing on its asks, and only there", () => {
		const { rerender } = render(
			<SubagentOriginChip message={{ ts: 1, type: "ask", ask: "tool", text: "{}", subagentOrigin: origin }} />,
		)
		expect(screen.getByTestId("subagent-origin").textContent).toContain("From Explorer 2 · read-only")
		expect(screen.getByTestId("subagent-origin").textContent).toContain("Survey the repo for NSE")
		rerender(<SubagentOriginChip message={{ ts: 1, type: "ask", ask: "tool", text: "{}" }} />)
		expect(screen.queryByTestId("subagent-origin")).toBeNull()
		// a say row never carries one, and the chip ignores it if it did
		rerender(<SubagentOriginChip message={{ ts: 1, type: "say", say: "text", text: "x", subagentOrigin: origin }} />)
		expect(screen.queryByTestId("subagent-origin")).toBeNull()
	})
})

describe("SubagentLaunchCard", () => {
	const launch: SubagentLaunch = {
		profile: "explorer",
		prompts: ["Find every use of nse", "Summarise the session"],
		budget: { maxToolCalls: 30, wallClockMs: 600_000, maxOutputTokens: 40_000, contextStopFraction: 0.8, maxCostUsd: 2 },
		model: "claude-sonnet-4",
		limits: "No file writes, no commands, no network or browser tools.",
	}
	it("shows exactly what will run before it runs", () => {
		render(<SubagentLaunchCard state="pending" tool={{ tool: "spawnSubagents", subagents: launch }} />)
		expect(screen.getByText("Start 2 read-only explorers")).toBeTruthy()
		expect(screen.getByTestId("subagent-launch-prompts").textContent).toContain("Find every use of nse")
		expect(screen.getByTestId("subagent-launch-limits").textContent).toContain("No file writes")
		expect(screen.getByTestId("subagent-launch-budget").textContent).toMatch(/claude-sonnet-4.*30 tool calls.*10 minutes/)
	})
	it("uses past tense only once it was decided", () => {
		const { rerender } = render(<SubagentLaunchCard state="executed" tool={{ tool: "spawnSubagents", subagents: launch }} />)
		expect(screen.getByText("Started 2 read-only explorers")).toBeTruthy()
		rerender(<SubagentLaunchCard state="denied" tool={{ tool: "spawnSubagents", subagents: launch }} />)
		expect(screen.getByText("Did not start 2 read-only explorers")).toBeTruthy()
	})
})

describe("InlineApproval for a subagent's ask (AC5)", () => {
	const TRUSTED: McpServer = {
		name: "stub",
		config: "{}",
		status: "connected",
		trust: { trusted: true, reason: "fixture" },
		tools: [{ name: "read_tool", description: "x", annotations: { readOnlyHint: true, openWorldHint: false } }],
	}
	const mcpAsk = (extra: Partial<AiHydroMessage> = {}): AiHydroMessage => ({
		ts: 100,
		type: "ask",
		ask: "use_mcp_server",
		text: JSON.stringify({ serverName: "stub", type: "use_mcp_tool", toolName: "read_tool", arguments: "{}" }),
		...extra,
	})
	beforeEach(() => {
		state = {}
	})
	function mount(message: AiHydroMessage) {
		state = {
			mcpServers: [TRUSTED],
			aihydroMessages: [{ ts: 1, type: "say", say: "task", text: "go" }, message],
			autoApprovalSettings: { enabled: true, actions: { useMcp: true } },
			yoloModeToggled: false,
		}
		return render(
			<PendingAskProvider
				chatState={{ inputValue: "", selectedImages: [], selectedFiles: [], textAreaRef: { current: null } } as any}
				messageHandlers={{ executeButtonAction: vi.fn(async () => {}) } as any}>
				<InlineApproval message={message} />
			</PendingAskProvider>,
		)
	}

	it("offers Always for the main agent's eligible MCP ask, but never for a subagent's", () => {
		const own = mount(mcpAsk())
		expect(screen.queryByTestId("inline-approval-always")).toBeTruthy()
		own.unmount()
		mount(mcpAsk({ subagentOrigin: origin }))
		expect(screen.getByTestId("inline-approval")).toBeTruthy() // Run and Deny stay
		expect(screen.getByTestId("inline-approval-primary")).toBeTruthy()
		expect(screen.getByTestId("inline-approval-deny")).toBeTruthy()
		expect(screen.queryByTestId("inline-approval-always")).toBeNull()
	})
})

describe("Stop while explorers run (AC6)", () => {
	it("a trailing status row counts as a running task, so Stop (and Escape) are offered", () => {
		expect(isTaskRunning(row([child()]))).toBe(true)
	})
})
