import { presentTranscript, type TranscriptItem, type WorkGroup } from "@shared/aihydro/transcriptPresenter"
import type { AiHydroMessage, StudyBindingState } from "@shared/ExtensionMessage"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { run8ToolsTask } from "@/screens/fixtures/transcripts"
import { processMessages } from "../../chat/chat-view/utils/messageUtils"
import { StudyChipView, StudyPickerPanelView } from "../../chat/task-header/StudyChip"
import { WorkGroupRow } from "../../chat/transcript/WorkGroupRow"
import { PausedTrustAction } from "../TrustLauncherButton"

const mock = vi.hoisted(() => ({
	run: vi.fn(async () => ({})),
	servers: [] as { name: string; disabled?: boolean; trust?: { trusted: boolean; reason: string } }[],
}))
vi.mock("@/services/grpc-client", () => ({
	CheckpointsServiceClient: {},
	McpServiceClient: { runToolsEnvAction: mock.run, subscribeToToolsEnvStatus: () => () => {} },
}))
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ mcpServers: mock.servers, onRelinquishControl: () => () => {} }),
}))

const untrusted = { name: "aihydro-tools", trust: { trusted: false, reason: "x" } }
const trusted = { name: "aihydro-tools", trust: { trusted: true, reason: "x" } }
const TRUST = "Trust this launcher…"

beforeEach(() => {
	mock.servers = [untrusted]
})
afterEach(() => {
	cleanup()
	mock.run.mockClear()
})

const expectHostAsked = (serverName = "aihydro-tools") => {
	expect(mock.run).toHaveBeenCalledTimes(1)
	// Only a request for the host's own confirmation goes out (with the server the surface is about, which the
	// host re-validates): the webview records nothing.
	expect(mock.run).toHaveBeenCalledWith(expect.objectContaining({ action: "trust", serverName }))
}

describe("paused-grant card", () => {
	it("offers the action while the server is untrusted, and the click only asks the host", () => {
		render(<PausedTrustAction serverName="aihydro-tools" />)
		fireEvent.click(screen.getByRole("button", { name: TRUST }))
		expectHostAsked()
	})
	it("is absent once the server is trusted or disabled", () => {
		mock.servers = [trusted]
		const { unmount } = render(<PausedTrustAction serverName="aihydro-tools" />)
		expect(screen.queryByRole("button", { name: TRUST })).toBeNull()
		unmount()
		mock.servers = [{ ...untrusted, disabled: true }]
		render(<PausedTrustAction serverName="aihydro-tools" />)
		expect(screen.queryByRole("button", { name: TRUST })).toBeNull()
	})
})

describe("study chip", () => {
	const unavailable: StudyBindingState = {
		chatId: "c",
		status: "unavailable",
		reason: "AI-Hydro Tools is running from a new location (`/x/aihydro-mcp`). Your auto-run settings are paused until you confirm it.",
		canChoose: false,
	}
	const handlers = { onChoose: vi.fn(), onDecline: vi.fn() }

	it("untrusted cause: the chip says 'Study unavailable', its tooltip says why, and the panel carries the action", () => {
		const binding = { ...unavailable, cause: "untrusted_server" as const, causeServer: "aihydro-tools" }
		render(
			<>
				<StudyChipView binding={binding} onOpen={vi.fn()} {...handlers} />
				<StudyPickerPanelView binding={binding} {...handlers} />
			</>,
		)
		expect(screen.getByText("Study unavailable")).toBeTruthy()
		expect(document.getElementById("bound-study")?.getAttribute("title")).toContain("running from a new location")
		fireEvent.click(screen.getByRole("button", { name: TRUST }))
		expectHostAsked()
	})

	it("any other state has no action (not connected, bound, none, choose)", () => {
		const others: StudyBindingState[] = [
			unavailable,
			{ chatId: "c", status: "bound", studyId: "s", canChoose: true },
			{ chatId: "c", status: "none", canChoose: true },
		]
		for (const binding of others) {
			const { unmount } = render(<StudyPickerPanelView binding={binding} {...handlers} />)
			expect(screen.queryByRole("button", { name: TRUST })).toBeNull()
			unmount()
		}
	})
})

describe("transcript 'server not trusted' line", () => {
	const msgs = processMessages(run8ToolsTask.slice(1)) as AiHydroMessage[]
	const group = (effect: "UNVERIFIED" | "UNKNOWN") => {
		const items: TranscriptItem[] = presentTranscript(msgs, {
			detail: "normal",
			effectClassFor: () => effect,
			isProtectedPath: () => false,
		})
		return items.find((i): i is WorkGroup => i.kind === "group") as WorkGroup
	}
	const renderGroup = (g: WorkGroup) =>
		render(
			<WorkGroupRow
				allMessages={msgs}
				expanded={true}
				expandedCalls={{}}
				group={g}
				live={false}
				onToggle={() => {}}
				onToggleCall={() => {}}
				renderMessage={() => null}
			/>,
		)

	it("carries the action when a first-party server is untrusted", () => {
		const g = group("UNVERIFIED")
		mock.servers = [{ ...untrusted, name: g.lifted[0].server ?? "" }]
		renderGroup(g)
		expect(g.lifted[0].untrustedFirstParty).toBe(true)
		expect(screen.getAllByText(/server not trusted/).length).toBeGreaterThan(0)
		fireEvent.click(screen.getByRole("button", { name: TRUST }))
		expectHostAsked(g.lifted[0].server)
	})

	it("drops the action after the server is trusted (the history line stays, the button goes)", () => {
		const g = group("UNVERIFIED")
		mock.servers = [{ ...trusted, name: g.lifted[0].server ?? "" }]
		renderGroup(g)
		expect(screen.queryByRole("button", { name: TRUST })).toBeNull()
	})

	it("has no action on lines about something else (effect not declared)", () => {
		renderGroup(group("UNKNOWN"))
		expect(screen.queryByRole("button", { name: TRUST })).toBeNull()
	})
})
