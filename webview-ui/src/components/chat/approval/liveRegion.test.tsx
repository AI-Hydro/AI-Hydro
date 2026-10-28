import type { DetailLevel } from "@shared/aihydro/transcriptPresenter"
import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MessagesArea } from "../chat-view/components/layout/MessagesArea"
import { buildTranscriptView, filterVisibleMessages, groupMessages, processMessages } from "../chat-view/utils/messageUtils"

vi.mock("react-virtuoso", () => ({ Virtuoso: () => null }))
vi.mock("@/services/grpc-client", () => ({ UiServiceClient: {}, StateServiceClient: {} }))
vi.mock("@/components/settings/utils/settingsHandlers", () => ({ updateSetting: vi.fn() }))
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => ({}) }))

const task: AiHydroMessage = { ts: 1, type: "say", say: "task", text: "go" }
const command = (ts: number, text: string): AiHydroMessage => ({ ts, type: "ask", ask: "command", text })

function area(messages: AiHydroMessage[], detail: DetailLevel) {
	const processed = processMessages(messages.slice(1))
	const grouped = groupMessages(filterVisibleMessages(processed))
	const view = buildTranscriptView(processed, grouped, { detail })
	const sb: any = {
		virtuosoRef: { current: null },
		scrollContainerRef: { current: null },
		toggleRowExpansion: vi.fn(),
		handleRowHeightChange: vi.fn(),
		setIsAtBottom: vi.fn(),
		setShowScrollToBottom: vi.fn(),
		disableAutoScrollRef: { current: false },
		isAtBottom: true,
		scrollToBottomSmooth: vi.fn(),
	}
	return (
		<MessagesArea
			chatState={{ expandedRows: {}, inputValue: "", setActiveQuote: vi.fn() } as any}
			detail={detail}
			groupedMessages={grouped}
			isRunning={false}
			messageHandlers={{} as any}
			modifiedMessages={processed}
			scrollBehavior={sb}
			task={task}
			view={view}
		/>
	)
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
/** The status region is throttled; let it settle. */
const settle = () => act(() => void vi.advanceTimersByTime(2500))
const status = () => screen.getByTestId("transcript-status").textContent

describe("live region announces a pending approval once per ask", () => {
	for (const detail of ["focus", "normal", "verbose"] as const) {
		it(`${detail}: says what is waiting, and a state post for the same ask does not change the text`, () => {
			const view = render(area([task, command(100, "pytest -q")], detail))
			expect(status()).toBe("Waiting for your approval: Command pytest -q")
			// Same ask, rebuilt message list (a state post) with a different body: no new announcement text.
			view.rerender(area([task, command(100, "pytest -q --lf")], detail))
			expect(status()).toBe("Waiting for your approval: Command pytest -q")
		})

		it(`${detail}: a new ask is a new announcement`, () => {
			const view = render(area([task, command(100, "ls")], detail))
			view.rerender(
				area([task, command(100, "ls"), { ts: 150, type: "say", say: "text", text: "ok" }, command(200, "pwd")], detail),
			)
			settle()
			expect(status()).toBe("Waiting for your approval: Command pwd")
		})
	}

	it("clears once the ask is answered", () => {
		const view = render(area([task, command(100, "ls")], "verbose"))
		view.rerender(
			area(
				[task, { ...command(100, "ls"), askOutcome: "approved" }, { ts: 150, type: "say", say: "text", text: "done" }],
				"verbose",
			),
		)
		settle()
		expect(status()).toBe("")
	})
})
