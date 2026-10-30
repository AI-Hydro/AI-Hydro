import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ActionButtons } from "../chat-view/components/layout/ActionButtons"

const executeButtonAction = vi.fn()
beforeEach(() => executeButtonAction.mockClear())

function renderButtons(message: AiHydroMessage, showScrollToBottom: boolean, isAtBottom = !showScrollToBottom) {
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
				{
					scrollToBottomSmooth,
					disableAutoScrollRef,
					showScrollToBottom,
					isAtBottom,
					virtuosoRef: { current: null },
				} as any
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
		const pill = screen.getByRole("button", { name: "Approval waiting, scroll to it" })
		expect(pill.textContent).toContain("Approval waiting")
		fireEvent.click(pill)
		// It scrolls; it never answers the ask.
		expect(scrollToBottomSmooth).toHaveBeenCalledOnce()
		expect(disableAutoScrollRef.current).toBe(false)
		expect(executeButtonAction).not.toHaveBeenCalled()
	})

	it("the pill shows whenever the list is not at the bottom, even when the wheel latch never fired (keyboard or scrollbar scrolling)", () => {
		const command: AiHydroMessage = { ts: 1, type: "ask", ask: "command", text: "ls" }
		// disableAutoScroll=false and showScrollToBottom=false: the state after PageUp, Home or dragging the scrollbar.
		renderButtons(command, false, false)
		expect(screen.getByRole("button", { name: "Approval waiting, scroll to it" })).toBeTruthy()
	})

	it("the pill's accessible name starts with its visible text (WCAG 2.5.3)", () => {
		const command: AiHydroMessage = { ts: 1, type: "ask", ask: "command", text: "ls" }
		renderButtons(command, false, false)
		const pill = screen.getByTestId("approval-waiting-pill")
		expect(pill.getAttribute("aria-label")?.startsWith("Approval waiting")).toBe(true)
		expect(pill.textContent).toContain("Approval waiting")
	})

	it("no pill while the approval is in view", () => {
		const command: AiHydroMessage = { ts: 1, type: "ask", ask: "command", text: "ls" }
		renderButtons(command, false)
		expect(screen.queryByRole("button", { name: /Scroll to/ })).toBeNull()
	})

	it("New chat still renders when scrolled up, with the plain scroll button", () => {
		const done: AiHydroMessage = { ts: 1, type: "ask", ask: "completion_result", text: "done" }
		renderButtons(done, true)
		expect(screen.getByText("New chat")).toBeTruthy()
		expect(screen.getByTestId("footer-actions")).toBeTruthy()
		expect(screen.getByRole("button", { name: "Scroll to bottom" })).toBeTruthy()
	})

	it("renders no scroll button when already at the bottom", () => {
		const done: AiHydroMessage = { ts: 1, type: "ask", ask: "completion_result", text: "done" }
		renderButtons(done, false)
		expect(screen.queryByRole("button", { name: "Scroll to bottom" })).toBeNull()
	})

	it("a finished task offers a modest secondary New chat button, not a full-width bar, and routes through new_task", () => {
		const done: AiHydroMessage = { ts: 1, type: "ask", ask: "completion_result", text: "done" }
		renderButtons(done, false)
		const button = screen.getByTestId("new-chat-button")
		expect(button.className).toContain("aih-btn")
		expect(button.className).not.toContain("aih-btn--primary")
		expect(screen.getByTestId("footer-actions").className).toContain("aih-footer-action")
		fireEvent.click(button)
		// The host's clearTask asks before it stops a running chat; the button only requests new_task.
		expect(executeButtonAction).toHaveBeenCalledWith("new_task", "", [], [])
	})

	it("keeps both buttons, Retry and New chat, when a request failed", () => {
		const failed: AiHydroMessage = { ts: 1, type: "ask", ask: "api_req_failed", text: "boom" }
		renderButtons(failed, false)
		expect(screen.getByText("Retry")).toBeTruthy()
		expect(screen.getByText("New chat")).toBeTruthy()
		expect(screen.queryByTestId("new-chat-button")).toBeNull()
	})
})
