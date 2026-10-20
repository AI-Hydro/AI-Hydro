import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ActionButtons } from "../chat-view/components/layout/ActionButtons"

function renderButtons(message: AiHydroMessage, showScrollToBottom: boolean) {
	const scrollToBottomSmooth = vi.fn()
	const executeButtonAction = vi.fn()
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
	it("never replaces the ask buttons: Run/Deny stay while scrolled up, plus a floating scroll button", () => {
		const command: AiHydroMessage = { ts: 1, type: "ask", ask: "command", text: "ls" }
		const { scrollToBottomSmooth, disableAutoScrollRef } = renderButtons(command, true)
		expect(screen.getByText("Run Command")).toBeTruthy()
		expect(screen.getByText("Deny")).toBeTruthy()
		const scroll = screen.getByRole("button", { name: "Scroll to bottom" })
		expect(scroll.textContent?.trim()).toBe("")
		fireEvent.click(scroll)
		expect(scrollToBottomSmooth).toHaveBeenCalledOnce()
		expect(disableAutoScrollRef.current).toBe(false)
	})

	it("Start New Task still renders when scrolled up", () => {
		const done: AiHydroMessage = { ts: 1, type: "ask", ask: "completion_result", text: "done" }
		renderButtons(done, true)
		expect(screen.getByText("Start New Task")).toBeTruthy()
		expect(screen.getByRole("button", { name: "Scroll to bottom" })).toBeTruthy()
	})

	it("renders no scroll button when already at the bottom", () => {
		const command: AiHydroMessage = { ts: 1, type: "ask", ask: "command", text: "ls" }
		renderButtons(command, false)
		expect(screen.queryByRole("button", { name: "Scroll to bottom" })).toBeNull()
	})
})
