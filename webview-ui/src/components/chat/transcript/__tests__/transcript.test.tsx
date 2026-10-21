import { presentTranscript, type TranscriptItem, type WorkGroup } from "@shared/aihydro/transcriptPresenter"
import type { AiHydroMessage } from "@shared/ExtensionMessage"
import type { McpServer } from "@shared/mcp"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CheckmarkControl } from "@/components/common/CheckmarkControl"
import { fixtureMcpServers } from "@/screens/fixtures/aihydro"
import {
	answerInterruptedTask,
	answerPendingHiddenTask,
	answerRevisedTask,
	checkpointCheckedOutTask,
	failureLiftedTask,
	run8ToolsTask,
	turnMachineryTask,
} from "@/screens/fixtures/transcripts"
import { buildTranscriptView, filterVisibleMessages, groupMessages, processMessages } from "../../chat-view/utils/messageUtils"
import { makeTranscriptResolvers } from "../resolvers"
import { formatDuration, summarizeGroup } from "../summary"
import { TranscriptStatus } from "../TranscriptStatus"
import { WorkGroupRow } from "../WorkGroupRow"

const restore = vi.fn(async (_req: unknown) => ({}))
const diff = vi.fn(async (_req: unknown) => ({}))
vi.mock("@/services/grpc-client", () => ({
	CheckpointsServiceClient: {
		checkpointRestore: (req: unknown) => restore(req),
		checkpointDiff: (req: unknown) => diff(req),
	},
}))
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ onRelinquishControl: () => () => {} }),
}))

const processed = (task: AiHydroMessage[]) => processMessages(task.slice(1))
const trusted = makeTranscriptResolvers(fixtureMcpServers, [])
const presentNormal = (task: AiHydroMessage[]) => presentTranscript(processed(task), { detail: "normal", ...trusted })
const groups = (items: TranscriptItem[]) => items.filter((i): i is WorkGroup => i.kind === "group")

function Harness({ group, messages }: { group: WorkGroup; messages: AiHydroMessage[] }) {
	const [open, setOpen] = useState<Record<string, boolean>>({})
	const [calls, setCalls] = useState<Record<number, boolean>>({})
	return (
		<WorkGroupRow
			allMessages={messages}
			expanded={open[group.key] ?? group.open}
			expandedCalls={calls}
			group={group}
			live={false}
			onToggle={(key) => setOpen((p) => ({ ...p, [key]: !(p[key] ?? group.open) }))}
			onToggleCall={(ts) => setCalls((p) => ({ ...p, [ts]: !p[ts] }))}
			renderMessage={(m) => <div data-testid="detail">{m.ts}</div>}
		/>
	)
}

beforeEach(() => {
	restore.mockClear()
	diff.mockClear()
})

describe("WorkGroupRow", () => {
	it("header is a real button with aria-expanded / aria-controls and a summary built from facts", () => {
		const msgs = processed(turnMachineryTask)
		const [group] = groups(presentNormal(turnMachineryTask))
		render(<Harness group={group} messages={msgs} />)
		const header = screen.getByRole("button", { name: /Ran 2 tools/ })
		expect(header.tagName).toBe("BUTTON")
		expect(header.getAttribute("aria-expanded")).toBe("false")
		const panel = document.getElementById(header.getAttribute("aria-controls") ?? "")
		expect(panel).not.toBeNull()
		expect(panel?.hidden).toBe(true)
		expect(header.textContent).toMatch(/^Worked .*· 2 tools · /)
		fireEvent.click(header)
		expect(header.getAttribute("aria-expanded")).toBe("true")
		expect(panel?.hidden).toBe(false)
		// one line per call, each its own button
		expect((panel as HTMLElement).querySelectorAll(".transcript-call button")).toHaveLength(2)
	})

	it("lifted lines are real text with an icon, visible while collapsed; the name carries the problem counts", () => {
		const msgs = processed(failureLiftedTask)
		const [group] = groups(presentNormal(failureLiftedTask))
		const { container } = render(<Harness group={group} messages={msgs} />)
		expect(document.querySelector(".transcript-group-toggle")?.getAttribute("aria-expanded")).toBe("false")
		const lines = container.querySelectorAll(".transcript-lifted-line")
		expect(lines.length).toBe(group.lifted.length)
		expect(lines.length).toBeGreaterThan(0)
		for (const li of Array.from(lines)) {
			expect(li.querySelector(".codicon")).not.toBeNull()
			expect(li.textContent?.trim().length).toBeGreaterThan(8)
		}
		expect(container.textContent).toContain("Skipped: 'fetch_flow' is not a tool")
		expect(screen.getByRole("button", { name: /1 tool, 2 failed|1 tool, \d failed/ })).toBeTruthy()
		// The collapsed panel is hidden but the lifted lines are not inside it.
		expect(container.querySelector("[hidden] .transcript-lifted-line")).toBeNull()
	})

	it("the checked-out checkpoint shows a visible banner line", () => {
		const msgs = processed(checkpointCheckedOutTask)
		const [group] = groups(presentNormal(checkpointCheckedOutTask))
		const { container } = render(<Harness group={group} messages={msgs} />)
		const banner = container.querySelector(".transcript-banner")
		expect(banner?.textContent).toContain("restored to this checkpoint")
	})

	it("expansion is keyed by the group key and survives streaming appends", () => {
		const base = processed(run8ToolsTask).slice(0, 8)
		const before = groups(presentNormal([{ ts: 0, type: "say", say: "task", text: "x" } as AiHydroMessage, ...base]))[0]
		const more = processed(run8ToolsTask).slice(0, 12)
		const after = groups(presentNormal([{ ts: 0, type: "say", say: "task", text: "x" } as AiHydroMessage, ...more]))[0]
		expect(after.key).toBe(before.key)
		expect(after.facts.toolCount).toBeGreaterThan(before.facts.toolCount)

		function Stream({ group }: { group: WorkGroup }) {
			return <Harness group={group} messages={more} />
		}
		const { rerender } = render(<Stream group={before} />)
		const toggle = () => document.querySelector(".transcript-group-toggle") as HTMLElement
		const callLines = () => document.querySelectorAll(".transcript-call").length
		// The live tail starts open at Normal; the user's collapse is theirs and a later append does not undo it.
		expect(before.open).toBe(true)
		expect(callLines()).toBe(before.facts.toolCount)
		fireEvent.click(toggle())
		expect(callLines()).toBe(0)
		rerender(<Stream group={after} />)
		expect(toggle().getAttribute("aria-expanded")).toBe("false")
		expect(callLines()).toBe(0)
		fireEvent.click(toggle())
		expect(callLines()).toBe(after.facts.toolCount)
	})

	it("moves focus to the header when a live group collapses with focus inside it", () => {
		const msgs = processed(run8ToolsTask)
		const [group] = groups(presentNormal(run8ToolsTask))
		const props = {
			allMessages: msgs,
			expandedCalls: {},
			group,
			live: false,
			onToggle: () => {},
			onToggleCall: () => {},
			renderMessage: () => null,
		}
		const { rerender } = render(<WorkGroupRow {...props} expanded />)
		const firstCall = document.querySelector(".transcript-call button") as HTMLElement
		firstCall.focus()
		expect(document.activeElement).toBe(firstCall)
		rerender(<WorkGroupRow {...props} expanded={false} />)
		expect(document.activeElement).toBe(document.querySelector(".transcript-group-toggle"))
	})
})

describe("summary honesty", () => {
	const facts = (over: Record<string, unknown> = {}) => ({
		agentMs: 112_000,
		waitingMs: 0,
		toolCount: 8,
		notRunCount: 0,
		cost: { status: "exact", usd: 0.0535, label: "$0.0535" } as const,
		requestCount: 4,
		retryCount: 0,
		failedRequestCount: 0,
		reuseCount: 0,
		revisionCount: 0,
		liftedCount: 0,
		...over,
	})
	it("reads like the spec example", () => {
		expect(summarizeGroup(facts(), [], false).text).toBe("Worked 1m 52s · 8 tools · $0.0535")
	})
	it("never invents a cost: unrecorded and lower-bound read through their labels", () => {
		const none = summarizeGroup(
			facts({ cost: { status: "unrecorded", usd: null, label: "no cost recorded" } }),
			[],
			false,
		).text
		expect(none).toContain("no cost recorded")
		expect(none).not.toMatch(/\$0\.0000/)
		const lower = summarizeGroup(
			facts({ cost: { status: "lower-bound", usd: 0.02, label: "at least $0.02" } }),
			[],
			false,
		).text
		expect(lower).toContain("at least $0.02")
		expect(summarizeGroup(facts({ cost: { status: "none", usd: null, label: "" } }), [], false).text).not.toContain("$")
	})
	it("separates agent time from waiting, and counts retries, reuse, not-run and revisions", () => {
		const s = summarizeGroup(
			facts({ waitingMs: 30_000, retryCount: 2, reuseCount: 1, notRunCount: 1, revisionCount: 1 }),
			[],
			false,
		)
		expect(s.text).toContain("Worked 1m 52s")
		expect(s.text).toContain("30s waiting for you")
		expect(s.text).toContain("2 retries")
		expect(s.text).toContain("1 reused")
		expect(s.text).toContain("1 not run")
		expect(s.text).toContain("1 revision")
	})
	it("the accessible name leads with what went wrong", () => {
		const lifted = [{ key: "a", reason: "call_failed", tone: "error", text: "Failed", sourceTs: 1 }] as never
		expect(summarizeGroup(facts(), lifted, false).label.startsWith("Ran 8 tools, 1 failed.")).toBe(true)
	})
	it("a measured sub-second span is not shown as zero", () => {
		expect(formatDuration(400)).toBe("<1s")
		expect(formatDuration(3_725_000)).toBe("1h 2m")
	})
})

describe("verbose is today's output", () => {
	it("passes the legacy pipeline's entries through untouched", () => {
		const msgs = processed(turnMachineryTask)
		const grouped = groupMessages(filterVisibleMessages(msgs))
		const view = buildTranscriptView(msgs, grouped, { detail: "verbose", ...trusted })
		expect(view.entries.every((e) => e.mode === "legacy")).toBe(true)
		expect(view.entries.map((e) => (e.mode === "legacy" ? e.entry : null))).toEqual(grouped)
		expect(view.scrollEntries).toBe(grouped)
	})
	it("normal hides the machinery the owner complained about but keeps prose and the answer", () => {
		const msgs = processed(turnMachineryTask)
		const view = buildTranscriptView(msgs, groupMessages(filterVisibleMessages(msgs)), { detail: "normal", ...trusted })
		const kinds = view.entries.map((e) => (e.mode === "presented" ? e.item.kind : "legacy"))
		expect(kinds).toEqual(["group", "prose", "answer"])
		const [g] = groups(view.entries.flatMap((e) => (e.mode === "presented" ? [e.item] : [])))
		expect(g.lifted.map((l) => l.text).join("\n")).toContain("malformed tool call; retried")
	})
})

describe("resolvers", () => {
	const server = (over: Partial<McpServer>): McpServer[] => [
		{
			name: "ai-hydro",
			config: "{}",
			status: "connected",
			tools: [{ name: "delineate_basin", annotations: { readOnlyHint: true, openWorldHint: false } }],
			...over,
		},
	]
	const liftedFor = (servers: McpServer[]) =>
		groups(
			presentTranscript(processed(turnMachineryTask), { detail: "normal", ...makeTranscriptResolvers(servers, []) }),
		)[0].lifted.map((l) => l.reason)

	it("a trusted server's annotations fold a read-only call", () => {
		const fixture: McpServer[] = [{ ...fixtureMcpServers[0], tools: [...(fixtureMcpServers[0].tools ?? [])] }]
		expect(liftedFor(fixture)).not.toContain("approved_security")
	})
	it("an untrusted server's readOnlyHint does NOT fold the call", () => {
		expect(liftedFor(server({ trust: { trusted: false, reason: "launch differs" } }))).toContain("approved_security")
		expect(liftedFor(server({ trust: undefined }))).toContain("approved_security")
	})
	it("a trusted server without annotations lifts (UNKNOWN)", () => {
		expect(liftedFor(server({ trust: { trusted: true, reason: "ok" }, tools: [{ name: "delineate_basin" }] }))).toContain(
			"approved_security",
		)
	})
	it("protected roots narrow native path lifting", () => {
		const r = makeTranscriptResolvers([], ["/home/u/.aihydro/approvals"])
		expect(r.isProtectedPath?.("/home/u/.aihydro/approvals/x.json")).toBe(true)
		expect(r.isProtectedPath?.("/work/proj/a.ts")).toBe(false)
	})
})

describe("Rewind", () => {
	it("runs the same checkpoint RPC as the checkpoint row, labelled per action with the scope note", () => {
		const messages = processed(turnMachineryTask)
		const [group] = groups(presentNormal(turnMachineryTask))
		const checkpointTs = group.members.find((m) => m.say === "checkpoint_created")?.ts as number
		const { unmount } = render(<Harness group={group} messages={messages} />)
		fireEvent.click(screen.getByRole("button", { name: "Rewind this work" }))
		const menu = screen.getByRole("group", { name: "Rewind this work" })
		for (const label of ["Restore files", "Restore task", "Restore files and task"]) {
			expect(within(menu).getByRole("button", { name: label })).toBeTruthy()
		}
		expect(menu.textContent).toContain("Workspace files only")
		expect(menu.textContent?.match(/Does not undo recorded claims, runs or MCP side effects \(~\/\.aihydro\)/g)).toHaveLength(
			3,
		)
		fireEvent.click(within(menu).getByRole("button", { name: "Restore files" }))
		fireEvent.click(within(menu).getByRole("button", { name: "Restore task" }))
		fireEvent.click(within(menu).getByRole("button", { name: "Restore files and task" }))
		const viaRewind = restore.mock.calls.map((c) => c[0])
		unmount()

		restore.mockClear()
		render(<CheckmarkControl messageTs={checkpointTs} />)
		fireEvent.click(screen.getByText("Restore"))
		fireEvent.click(screen.getByText("Restore Files"))
		fireEvent.click(screen.getByText("Restore Task Only"))
		fireEvent.click(screen.getByText("Restore Files & Task"))
		expect(restore.mock.calls.map((c) => c[0])).toEqual(viaRewind)
		expect(viaRewind.map((r) => (r as { restoreType: string }).restoreType)).toEqual([
			"workspace",
			"task",
			"taskAndWorkspace",
		])
		expect((viaRewind[0] as { number: number }).number).toBe(checkpointTs)
	})

	it("is reachable by keyboard: the trigger is a focusable button and Escape closes the menu", () => {
		const messages = processed(turnMachineryTask)
		const [group] = groups(presentNormal(turnMachineryTask))
		render(<Harness group={group} messages={messages} />)
		const trigger = screen.getByRole("button", { name: "Rewind this work" })
		expect(trigger.getAttribute("tabindex")).toBeNull()
		fireEvent.click(trigger)
		expect(trigger.getAttribute("aria-expanded")).toBe("true")
		fireEvent.keyDown(document, { key: "Escape" })
		expect(trigger.getAttribute("aria-expanded")).toBe("false")
		expect(document.activeElement).toBe(trigger)
	})
})

describe("TranscriptStatus", () => {
	it("is one polite status region and throttles updates", () => {
		vi.useFakeTimers()
		const { rerender } = render(<TranscriptStatus text="Running a" throttleMs={2000} />)
		const region = screen.getByTestId("transcript-status")
		expect(region.getAttribute("aria-live")).toBe("polite")
		expect(region.getAttribute("role")).toBe("status")
		act(() => {
			vi.advanceTimersByTime(10)
		})
		rerender(<TranscriptStatus text="Running b" throttleMs={2000} />)
		act(() => {
			vi.advanceTimersByTime(10)
		})
		rerender(<TranscriptStatus text="Answer ready" throttleMs={2000} />)
		act(() => {
			vi.advanceTimersByTime(3000)
		})
		expect(region.textContent).toBe("Answer ready")
		vi.useRealTimers()
	})
})

describe("answer-audit rows in the transcript (W2-C)", () => {
	const view = (task: AiHydroMessage[]) => {
		const msgs = processed(task)
		return buildTranscriptView(msgs, groupMessages(filterVisibleMessages(msgs)), { detail: "normal", ...trusted })
	}
	it("a pending row is invisible: one group, no revision, no draft text anywhere", () => {
		const v = view(answerPendingHiddenTask)
		const kinds = v.entries.map((e) => (e.mode === "presented" ? e.item.kind : "legacy"))
		expect(kinds).toEqual(["group", "answer"])
		const g = (v.entries[0] as { item: WorkGroup }).item
		expect(g.facts.toolCount).toBe(2)
		expect(g.facts.revisionCount).toBe(0)
		expect(JSON.stringify(v.entries.map((e) => (e.mode === "presented" ? e.item : null)))).not.toContain("UNCHECKED DRAFT")
	})
	it("a revision shows as a divider and the final audit attaches to its answer", () => {
		const kinds = view(answerRevisedTask).entries.map((e) => (e.mode === "presented" ? e.item.kind : "legacy"))
		expect(kinds).toContain("divider")
		const answer = view(answerRevisedTask).entries.find((e) => e.mode === "presented" && e.item.kind === "answer")
		expect(answer && answer.mode === "presented" && answer.auditMessage).toBeTruthy()
	})
	it("an interrupted row is shown as a divider, not dropped", () => {
		const kinds = view(answerInterruptedTask).entries.map((e) => (e.mode === "presented" ? e.item.kind : "legacy"))
		expect(kinds).toContain("divider")
	})
})

describe("W2-A2 review notes", () => {
	it("N3: the header's accessible name contains the visible summary verbatim and counts notices", () => {
		const msgs = processed(run8ToolsTask)
		const unannotated = makeTranscriptResolvers([{ ...fixtureMcpServers[0], tools: [{ name: "data_fetch" }] }], [])
		const [group] = groups(presentTranscript(msgs, { detail: "normal", ...unannotated }))
		render(<Harness group={group} messages={msgs} />)
		const header = document.querySelector(".transcript-group-toggle") as HTMLElement
		const visible = header.textContent?.trim() ?? ""
		expect(header.getAttribute("aria-label")).toContain(visible)
		expect(header.getAttribute("aria-label")).toMatch(/\d+ notices?/)
	})

	it("N1: an undeclared-effect first-party call is listed with a neutral tone, not a warning", () => {
		const msgs = processed(run8ToolsTask)
		const unannotated = makeTranscriptResolvers([{ ...fixtureMcpServers[0], tools: [] }], [])
		const [group] = groups(presentTranscript(msgs, { detail: "normal", ...unannotated }))
		expect(group.lifted.length).toBeGreaterThan(0)
		expect(new Set(group.lifted.map((l) => l.tone))).toEqual(new Set(["notice"]))
		expect(group.lifted[0].text).toContain("effect not declared by the server")
	})

	it("B1: an interrupted audit does not make the header say revision", () => {
		const msgs = processed(answerInterruptedTask)
		const items = presentTranscript(msgs, { detail: "normal", ...trusted })
		for (const g of groups(items)) {
			expect(summarizeGroup(g.facts, g.lifted, false).text).not.toMatch(/revision/)
		}
	})

	it("N6: opening Rewind moves focus into the menu; tabbing away closes it", () => {
		const messages = processed(turnMachineryTask)
		const [group] = groups(presentNormal(turnMachineryTask))
		render(
			<div>
				<Harness group={group} messages={messages} />
				<button type="button">elsewhere</button>
			</div>,
		)
		fireEvent.click(screen.getByRole("button", { name: "Rewind this work" }))
		const menu = screen.getByRole("group", { name: "Rewind this work" })
		expect(menu.contains(document.activeElement)).toBe(true)
		const trigger = screen.getByRole("button", { name: "Rewind this work" })
		fireEvent.blur(document.activeElement as HTMLElement, { relatedTarget: screen.getByText("elsewhere") })
		expect(trigger.getAttribute("aria-expanded")).toBe("false")
	})

	it("N2: Rewind on a user turn reads 'Rewind to this message'", async () => {
		const { RewindMenu } = await import("../RewindMenu")
		render(<RewindMenu checkpointTs={5} subject="to this message" />)
		expect(screen.getByRole("button", { name: "Rewind to this message" })).toBeTruthy()
	})

	it("N4: the detail toggle uses aria-pressed buttons", async () => {
		const { TranscriptDetailToggle } = await import("../TranscriptDetailToggle")
		const seen: string[] = []
		render(<TranscriptDetailToggle onChange={(l) => seen.push(l)} value="normal" />)
		expect(screen.getByRole("button", { name: "Normal" }).getAttribute("aria-pressed")).toBe("true")
		expect(screen.getByRole("button", { name: "Focus" }).getAttribute("aria-pressed")).toBe("false")
		fireEvent.click(screen.getByRole("button", { name: "Verbose" }))
		expect(seen).toEqual(["verbose"])
	})
})
