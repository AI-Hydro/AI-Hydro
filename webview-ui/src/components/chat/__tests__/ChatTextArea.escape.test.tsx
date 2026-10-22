import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { InputSection } from "../chat-view/components/layout/InputSection"
import { isTaskRunning } from "../chat-view/shared/buttonConfig"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mode: "act",
		apiConfiguration: {},
		openRouterModels: {},
		platform: "darwin",
		localWorkflowToggles: {},
		globalWorkflowToggles: {},
		showChatModelSelector: false,
		setShowChatModelSelector: () => {},
		dictationSettings: { featureEnabled: false },
	}),
}))
vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: new Proxy({}, { get: () => () => Promise.resolve({ files: [], values: [] }) }),
	McpServiceClient: new Proxy({}, { get: () => () => Promise.resolve({}) }),
	UiServiceClient: new Proxy({}, { get: () => () => Promise.resolve({}) }),
	StateServiceClient: new Proxy({}, { get: () => () => Promise.resolve({}) }),
	ModelsServiceClient: new Proxy({}, { get: () => () => Promise.resolve({}) }),
	TaskServiceClient: new Proxy({}, { get: () => () => Promise.resolve({}) }),
	SlashServiceClient: new Proxy({}, { get: () => () => Promise.resolve({}) }),
}))

/** The real InputSection, with minimal chat state: it owns the "only while running" gate. */
function Harness({ running, onStop }: { running: boolean; onStop: () => void }) {
	const [value, setValue] = useState("")
	const chatState = {
		activeQuote: null,
		setActiveQuote: () => {},
		isTextAreaFocused: false,
		inputValue: value,
		setInputValue: setValue,
		sendingDisabled: false,
		selectedImages: [],
		setSelectedImages: () => {},
		selectedFiles: [],
		setSelectedFiles: () => {},
		textAreaRef: { current: null },
		handleFocusChange: () => {},
	}
	return (
		<InputSection
			chatState={chatState as any}
			isTaskRunning={running}
			messageHandlers={
				{ executeButtonAction: (action: string) => action === "cancel" && onStop(), handleSendMessage: () => {} } as any
			}
			placeholderText="Type a message"
			scrollBehavior={{ isAtBottom: true, scrollToBottomAuto: () => {} } as any}
			selectFilesAndImages={async () => {}}
			shouldDisableFilesAndImages={false}
		/>
	)
}

describe("Escape in the prompt", () => {
	it("stops the task only while it is running", () => {
		const onStop = vi.fn()
		const { rerender } = render(<Harness onStop={onStop} running={false} />)
		const input = screen.getByTestId("chat-input")
		fireEvent.keyDown(input, { key: "Escape" })
		expect(onStop).not.toHaveBeenCalled()
		rerender(<Harness onStop={onStop} running />)
		fireEvent.keyDown(screen.getByTestId("chat-input"), { key: "Escape" })
		expect(onStop).toHaveBeenCalledTimes(1)
	})

	it("closes an open slash menu and does not stop the task", () => {
		const onStop = vi.fn()
		render(<Harness onStop={onStop} running />)
		const input = screen.getByTestId("chat-input") as HTMLTextAreaElement
		fireEvent.change(input, { target: { value: "/", selectionStart: 1, selectionEnd: 1 } })
		fireEvent.keyDown(input, { key: "Escape" })
		expect(onStop).not.toHaveBeenCalled()
	})

	it("closes an open @ context menu and does not stop the task", () => {
		const onStop = vi.fn()
		render(<Harness onStop={onStop} running />)
		const input = screen.getByTestId("chat-input") as HTMLTextAreaElement
		fireEvent.change(input, { target: { value: "@", selectionStart: 1, selectionEnd: 1 } })
		fireEvent.keyDown(input, { key: "Escape" })
		expect(onStop).not.toHaveBeenCalled()
	})
})

describe("compact stop button", () => {
	it("is present only while running, is at least 24px, and calls cancel once", () => {
		const onStop = vi.fn()
		const { rerender } = render(<Harness onStop={onStop} running={false} />)
		expect(screen.queryByRole("button", { name: "Stop task" })).toBeNull()
		expect(screen.getByTestId("send-button")).toBeInTheDocument()
		rerender(<Harness onStop={onStop} running />)
		const stop = screen.getByRole("button", { name: "Stop task" })
		expect(stop.className).toMatch(/w-\[28px\]/)
		expect(stop.querySelector(".codicon-debug-stop")).not.toBeNull()
		expect(screen.queryByTestId("send-button")).toBeNull()
		fireEvent.click(stop)
		expect(onStop).toHaveBeenCalledTimes(1)
	})

	it("does not render the old hint line under the prompt", () => {
		render(<Harness onStop={() => {}} running={false} />)
		expect(screen.queryByText(/Type @ for context/)).toBeNull()
	})
})

describe("isTaskRunning", () => {
	const now = Date.now()
	it("is true for streaming, an in-flight request, command output, and a background command", () => {
		expect(isTaskRunning({ ts: now, type: "say", say: "text", partial: true })).toBe(true)
		expect(isTaskRunning({ ts: now, type: "say", say: "api_req_started" })).toBe(true)
		expect(isTaskRunning({ ts: now, type: "ask", ask: "command_output", text: "x" })).toBe(true)
		expect(isTaskRunning({ ts: now, type: "ask", ask: "followup" }, true)).toBe(true)
	})
	it("is false when idle, awaiting an answer, or finished", () => {
		expect(isTaskRunning(undefined)).toBe(false)
		expect(isTaskRunning({ ts: now, type: "ask", ask: "tool", text: "{}" })).toBe(false)
		expect(isTaskRunning({ ts: now, type: "ask", ask: "completion_result", text: "done" })).toBe(false)
		expect(isTaskRunning({ ts: now, type: "ask", ask: "resume_task" })).toBe(false)
	})
})
