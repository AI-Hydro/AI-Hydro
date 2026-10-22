import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ActionButtons } from "../chat-view/components/layout/ActionButtons"

const executeButtonAction = vi.fn()
beforeEach(() => executeButtonAction.mockClear())

function renderButtons(message: AiHydroMessage, showScrollToBottom: boolean) {
	const scrollToBottomSmooth = vi.fn()
	const disableAutoScrollRef = { current: true }
	render(
		<ActionButtons
			chatState={
				{
					inputValue: "",
					selectedImages: [],
					selectedFiles: [],
					setSendingDisabled: vi.fn(),
					setInputValue: vi.fn(),
					setSelectedImages: vi.fn(),
					setSelectedFiles: vi.fn(),
				} as any
			}
			messageHandlers={{ executeButtonAction } as any}
			messages={[message]}
			mode="act"
			scrollBehavior={
				{ scrollToBottomSmooth, disableAutoScrollRef, showScrollToBottom, virtuosoRef: { current: null } } as any
			}
			task={message}
		/>,
	)
	return { scrollToBottomSmooth, disableAutoScrollRef }
}

describe("ActionButtons scroll-to-bottom", () => {
	it("a command approval has no footer Run/Deny (they are on the card); scrolled up, a labelled pill replaces the round button", () => {
		const command: AiHydroMessage = { ts: 1, type: "ask", ask: "command", text: "ls" }
		const { scrollToBottomSmooth, disableAutoScrollRef } = renderButtons(command, true)
		expect(screen.queryByText("Run Command")).toBeNull()
		expect(screen.queryByText("Deny")).toBeNull()
		expect(screen.queryByTestId("footer-actions")).toBeNull()
		expect(screen.queryByRole("button", { name: "Scroll to bottom" })).toBeNull()
		const pill = screen.getByRole("button", { name: "Scroll to pending approval" })
		expect(pill.textContent).toContain("Approval waiting")
		fireEvent.click(pill)
		// It scrolls; it never answers the ask.
		expect(scrollToBottomSmooth).toHaveBeenCalledOnce()
		expect(disableAutoScrollRef.current).toBe(false)
		expect(executeButtonAction).not.toHaveBeenCalled()
	})

	it("no pill while the approval is in view", () => {
		const command: AiHydroMessage = { ts: 1, type: "ask", ask: "command", text: "ls" }
		renderButtons(command, false)
		expect(screen.queryByRole("button", { name: /Scroll to/ })).toBeNull()
	})

	it("Start New Task still renders when scrolled up, with the plain scroll button", () => {
		const done: AiHydroMessage = { ts: 1, type: "ask", ask: "completion_result", text: "done" }
		renderButtons(done, true)
		expect(screen.getByText("Start New Task")).toBeTruthy()
		expect(screen.getByTestId("footer-actions")).toBeTruthy()
		expect(screen.getByRole("button", { name: "Scroll to bottom" })).toBeTruthy()
	})

	it("renders no scroll button when already at the bottom", () => {
		const done: AiHydroMessage = { ts: 1, type: "ask", ask: "completion_result", text: "done" }
		renderButtons(done, false)
		expect(screen.queryByRole("button", { name: "Scroll to bottom" })).toBeNull()
	})
})
