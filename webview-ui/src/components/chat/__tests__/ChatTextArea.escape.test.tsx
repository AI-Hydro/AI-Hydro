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
		expect(stop.className).toContain("aih-send")
		expect(stop.querySelector(".codicon-debug-stop")).not.toBeNull()
		expect(screen.queryByTestId("send-button")).toBeNull()
		fireEvent.click(stop)
		expect(onStop).toHaveBeenCalledTimes(1)
	})

	it("latches: two clicks, or a click plus Escape, produce exactly one cancel", () => {
		const onStop = vi.fn()
		render(<Harness onStop={onStop} running />)
		const stop = screen.getByRole("button", { name: "Stop task" })
		fireEvent.click(stop)
		fireEvent.click(stop)
		fireEvent.keyDown(screen.getByTestId("chat-input"), { key: "Escape" })
		expect(onStop).toHaveBeenCalledTimes(1)
		const busy = screen.getByRole("button", { name: "Stopping…" })
		expect(busy).toBeDisabled()
		expect(busy).toHaveAttribute("aria-busy", "true")
	})

	it("Escape then a click is also one cancel, and the latch clears when the task stops", () => {
		const onStop = vi.fn()
		const { rerender } = render(<Harness onStop={onStop} running />)
		fireEvent.keyDown(screen.getByTestId("chat-input"), { key: "Escape" })
		fireEvent.click(screen.getByRole("button", { name: "Stopping…" }))
		expect(onStop).toHaveBeenCalledTimes(1)
		rerender(<Harness onStop={onStop} running={false} />)
		rerender(<Harness onStop={onStop} running />)
		fireEvent.click(screen.getByRole("button", { name: "Stop task" }))
		expect(onStop).toHaveBeenCalledTimes(2)
	})

	it("renders the stop button for a streaming partial, an api_req retry and command_output", () => {
		const now = Date.now()
		const states = [
			{ ts: now, type: "say", say: "text", partial: true },
			{ ts: now, type: "say", say: "api_req_started" },
			{ ts: now, type: "ask", ask: "command_output", text: "x" },
		] as const
		for (const m of states) {
			const running = isTaskRunning(m as any)
			const { unmount } = render(<Harness onStop={() => {}} running={running} />)
			expect(screen.getByRole("button", { name: "Stop task" })).toBeInTheDocument()
			unmount()
		}
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

describe("send button and the Add menu", () => {
	it("is a flat codicon button, disabled while the input is empty, named Send message", () => {
		render(<Harness onStop={vi.fn()} running={false} />)
		const send = screen.getByRole("button", { name: "Send message" })
		expect(send).toBeDisabled()
		expect(send.className).toContain("aih-send")
		expect(send.className).not.toMatch(/gradient|shadow|scale/)
		expect(send.querySelector(".codicon-send")).not.toBeNull()
		fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "hello" } })
		expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled()
	})

	it("keeps four controls at rest: Add, model, mode, Send; rules and context live in the Add menu", () => {
		render(<Harness onStop={vi.fn()} running={false} />)
		expect(screen.queryByLabelText(/MCP Servers/)).toBeNull()
		expect(screen.queryByLabelText(/Rules & Workflows/)).toBeNull()
		expect(screen.queryByTestId("context-button")).toBeNull()
		const add = screen.getByRole("button", { name: "Add" })
		expect(add.querySelector(".codicon-add")).not.toBeNull()
		expect(add).toHaveAttribute("aria-haspopup", "menu")
		expect(add).toHaveAttribute("aria-expanded", "false")
		fireEvent.click(add)
		expect(add).toHaveAttribute("aria-expanded", "true")
		const items = screen.getAllByRole("menuitem").map((i) => i.textContent)
		expect(items).toEqual(["Add context (@)", "Attach files & images", "Rules & workflows"])
		expect(screen.getByTestId("context-button").querySelector(".codicon-mention")).not.toBeNull()
	})

	it("Escape closes the Add menu, returns focus to Add and does not stop a running task", () => {
		const onStop = vi.fn()
		render(<Harness onStop={onStop} running />)
		const add = screen.getByRole("button", { name: "Add" })
		fireEvent.click(add)
		fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
		expect(screen.queryByRole("menu")).toBeNull()
		expect(document.activeElement).toBe(add)
		expect(onStop).not.toHaveBeenCalled()
	})
})
