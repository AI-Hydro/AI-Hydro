import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { fireEvent, render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ActionButtons } from "../chat-view/components/layout/ActionButtons"

describe("ActionButtons Escape", () => {
	it("does not cancel the task from a window-level Escape (stop is bound on the prompt only)", () => {
		const executeButtonAction = vi.fn()
		const message: AiHydroMessage = { ts: 1, type: "say", say: "api_req_started", text: "{}" }
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
						scrollToBottomSmooth: vi.fn(),
						disableAutoScrollRef: { current: false },
						showScrollToBottom: false,
						virtuosoRef: { current: null },
					} as any
				}
				task={message}
			/>,
		)
		fireEvent.keyDown(window, { key: "Escape" })
		fireEvent.keyDown(document.body, { key: "Escape" })
		expect(executeButtonAction).not.toHaveBeenCalled()
	})
})
