import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const askResponse = vi.fn().mockResolvedValue({})
vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: { askResponse: (...a: unknown[]) => askResponse(...a), newTask: vi.fn() },
	SlashServiceClient: {},
}))
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => ({ backgroundCommandRunning: false }) }))

import { useMessageHandlers } from "./useMessageHandlers"

function state(ask: string | undefined) {
	return {
		setInputValue: vi.fn(),
		activeQuote: "quoted text",
		setActiveQuote: vi.fn(),
		setSelectedImages: vi.fn(),
		setSelectedFiles: vi.fn(),
		setSendingDisabled: vi.fn(),
		setEnableButtons: vi.fn(),
		aihydroAsk: ask,
		lastMessage: undefined,
	} as any
}

describe("sendAnswerFeedback", () => {
	beforeEach(() => askResponse.mockClear())

	it("sends the fixed text as a messageResponse with no quote, and leaves the draft, quote and attachments alone", async () => {
		const st = state("completion_result")
		const { result } = renderHook(() => useMessageHandlers([{ ts: 1, type: "say", say: "task", text: "t" }] as any, st))
		let ok = false
		await act(async () => {
			ok = await result.current.sendAnswerFeedback("cite please")
		})
		expect(ok).toBe(true)
		expect(askResponse).toHaveBeenCalledTimes(1)
		const req = askResponse.mock.calls[0][0]
		expect(req.responseType).toBe("messageResponse")
		expect(req.text).toBe("cite please")
		expect(req.text).not.toContain("[context]")
		expect(st.setInputValue).not.toHaveBeenCalled()
		expect(st.setActiveQuote).not.toHaveBeenCalled()
		expect(st.setSelectedImages).not.toHaveBeenCalled()
		expect(st.setSelectedFiles).not.toHaveBeenCalled()
		expect(st.setSendingDisabled).toHaveBeenCalledWith(true)
	})

	it("sends nothing and does not lock the input when no completion ask is pending", async () => {
		for (const ask of [undefined, "followup", "tool"]) {
			const st = state(ask)
			const { result } = renderHook(() => useMessageHandlers([], st))
			let ok = true
			await act(async () => {
				ok = await result.current.sendAnswerFeedback("cite please")
			})
			expect(ok).toBe(false)
			expect(st.setSendingDisabled).not.toHaveBeenCalled()
			expect(st.setEnableButtons).not.toHaveBeenCalled()
		}
		expect(askResponse).not.toHaveBeenCalled()
	})
})
