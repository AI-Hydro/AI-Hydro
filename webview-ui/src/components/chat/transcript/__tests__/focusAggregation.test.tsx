import { presentTranscript, type TranscriptItem, type WorkGroup } from "@shared/aihydro/transcriptPresenter"
import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { fixtureMcpServers } from "@/screens/fixtures/aihydro"
import { ownerApprovalPendingTask, run8ToolsTask } from "@/screens/fixtures/transcripts"
import { processMessages } from "../../chat-view/utils/messageUtils"
import { makeTranscriptResolvers } from "../resolvers"
import { useGroupExpansion } from "../useGroupExpansion"
import { WorkGroupRow } from "../WorkGroupRow"

vi.mock("@/services/grpc-client", () => ({ CheckpointsServiceClient: {} }))
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => ({ onRelinquishControl: () => () => {} }) }))

// A first-party server that publishes no annotations: the owner's installed tools server (2.3.7).
const unannotated = makeTranscriptResolvers([{ ...fixtureMcpServers[0], tools: [] }], [])
const processed = (task: AiHydroMessage[]) => processMessages(task.slice(1))
const present = (task: AiHydroMessage[], detail: "focus" | "normal") =>
	presentTranscript(processed(task), { detail, ...unannotated })
const groups = (items: TranscriptItem[]) => items.filter((i): i is WorkGroup => i.kind === "group")

function Row({ group, messages }: { group: WorkGroup; messages: AiHydroMessage[] }) {
	const [open, setOpen] = useState(group.open)
	return (
		<WorkGroupRow
			allMessages={messages}
			expanded={open}
			expandedCalls={{}}
			group={group}
			live={false}
			onToggle={() => setOpen((v) => !v)}
			onToggleCall={() => {}}
			renderMessage={() => null}
		/>
	)
}

describe("Focus and Normal render different DOM (X1-C1)", () => {
	it("Normal shows the server-level line; Focus shows the count in the header instead of a row", () => {
		const msgs = processed(run8ToolsTask)
		const [normal] = groups(present(run8ToolsTask, "normal"))
		const { unmount } = render(<Row group={normal} messages={msgs} />)
		expect(screen.getAllByText(/declares no effect hints \(8 calls/)).toHaveLength(1)
		expect(document.querySelectorAll(".transcript-lifted-line")).toHaveLength(1)
		unmount()

		const [focus] = groups(present(run8ToolsTask, "focus"))
		render(<Row group={focus} messages={msgs} />)
		expect(screen.queryByText(/declares no effect hints/)).toBeNull()
		expect(document.querySelectorAll(".transcript-lifted-line")).toHaveLength(0)
		expect(document.querySelector(".transcript-group-toggle")?.textContent).toContain("8 calls with no declared effect")
		// Nothing is lost: expanding lists the aggregate with its members.
		fireEvent.click(document.querySelector(".transcript-group-toggle") as HTMLElement)
		expect(screen.getByText(/declares no effect hints \(8 calls/)).toBeTruthy()
	})

	it("an aggregated line discloses every member with aria-expanded", () => {
		const msgs = processed(run8ToolsTask)
		const [normal] = groups(present(run8ToolsTask, "normal"))
		render(<Row group={normal} messages={msgs} />)
		const disclosure = screen.getByTestId("lifted-disclosure")
		expect(disclosure.getAttribute("aria-expanded")).toBe("false")
		// aria-controls always points at a real element, hidden while closed.
		expect((document.getElementById(disclosure.getAttribute("aria-controls") ?? "") as HTMLElement).hidden).toBe(true)
		fireEvent.click(disclosure)
		expect(disclosure.getAttribute("aria-expanded")).toBe("true")
		const list = document.getElementById(disclosure.getAttribute("aria-controls") ?? "")
		expect(list?.querySelectorAll("li")).toHaveLength(8)
		expect((list as HTMLElement).hidden).toBe(false)
	})

	it("the owner shape keeps the refusal visible at both levels and the pending ask is its own item", () => {
		for (const detail of ["focus", "normal"] as const) {
			const items = present(ownerApprovalPendingTask, detail)
			expect(items.at(-1)?.kind, detail).toBe("pending")
			const [g] = groups(items)
			expect(
				[...g.lifted].some((l) => l.reason === "mcp_error" || l.reason === "refusal"),
				detail,
			).toBe(true)
		}
	})
})

describe("useGroupExpansion: the level reset", () => {
	it("clears the reader's open/closed choices when the level changes, and only then", () => {
		const { result, rerender } = renderHook(({ d }) => useGroupExpansion(d), {
			initialProps: { d: "normal" as const } as never,
		})
		act(() => result.current.onToggleGroup("group:1", false))
		expect(result.current.groupExpanded).toEqual({ "group:1": true })
		rerender({ d: "normal" } as never)
		expect(result.current.groupExpanded).toEqual({ "group:1": true })
		rerender({ d: "focus" } as never)
		expect(result.current.groupExpanded).toEqual({})
		act(() => result.current.onToggleGroup("group:1", false))
		rerender({ d: "verbose" } as never)
		expect(result.current.groupExpanded).toEqual({})
	})

	it("cannot collapse a pending ask: it is not a group, so the reset has nothing to act on", () => {
		const items = present(ownerApprovalPendingTask, "normal")
		const pending = items.filter((i) => i.kind === "pending")
		expect(pending).toHaveLength(1)
		const { result, rerender } = renderHook(({ d }) => useGroupExpansion(d), { initialProps: { d: "normal" } as never })
		act(() => result.current.onToggleGroup(pending[0].key, true))
		rerender({ d: "focus" } as never)
		expect(result.current.groupExpanded).toEqual({})
		// After the reset, presenting at the new level still yields the same pending item.
		expect(
			present(ownerApprovalPendingTask, "focus")
				.filter((i) => i.kind === "pending")
				.map((i) => i.key),
		).toEqual(pending.map((i) => i.key))
	})
})
