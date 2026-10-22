import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const askResponse = vi.fn().mockResolvedValue({})
vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: { askResponse: (...a: unknown[]) => askResponse(...a), newTask: vi.fn() },
	SlashServiceClient: {},
}))
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => ({ backgroundCommandRunning: false }) }))

import { STALE_ASK_NOTICE, useMessageHandlers } from "./useMessageHandlers"

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

describe("ask responses are bound to the ask ts (W2-E1, M-1)", () => {
	beforeEach(() => {
		askResponse.mockReset()
		askResponse.mockResolvedValue({})
	})

	const askState = (ts: number) =>
		({ ...state("tool"), lastMessage: { ts, type: "ask", ask: "tool" }, setAskNotice: vi.fn() }) as any

	it("executeButtonAction sends the pending ask's ts, for every response action", async () => {
		const st = askState(1234)
		const { result } = renderHook(() => useMessageHandlers([], st))
		for (const action of ["approve", "reject", "proceed", "retry"] as const) {
			await act(async () => {
				await result.current.executeButtonAction(action, "")
			})
		}
		for (const call of askResponse.mock.calls) {
			expect(call[0].askTs).toBe(1234)
		}
		expect(askResponse).toHaveBeenCalledTimes(4)
	})

	it("an explicit ts (an inline card's own) wins over the pending ask", async () => {
		const st = askState(1234)
		const { result } = renderHook(() => useMessageHandlers([], st))
		await act(async () => {
			await result.current.executeButtonAction("approve", "", [], [], 99)
		})
		expect(askResponse.mock.calls[0][0].askTs).toBe(99)
	})

	it("messageResponse (handleSendMessage) sends the pending ask's ts", async () => {
		const st = askState(555)
		const { result } = renderHook(() => useMessageHandlers([{ ts: 1, type: "say", say: "task", text: "t" }] as any, st))
		await act(async () => {
			await result.current.handleSendMessage("hello", [], [])
		})
		expect(askResponse.mock.calls[0][0]).toMatchObject({ responseType: "messageResponse", askTs: 555 })
	})

	it("never sends ts 0: with no ask pending it sends the last message's ts, or a non-matching sentinel", async () => {
		const withSay = { ...state("tool"), lastMessage: { ts: 777, type: "say", say: "text" }, setAskNotice: vi.fn() } as any
		const first = renderHook(() => useMessageHandlers([], withSay))
		await act(async () => {
			await first.result.current.executeButtonAction("approve", "")
		})
		expect(askResponse.mock.calls[0][0].askTs).toBe(777)

		const empty = state("tool")
		const second = renderHook(() => useMessageHandlers([], empty))
		await act(async () => {
			await second.result.current.executeButtonAction("approve", "")
		})
		const sentinel = askResponse.mock.calls[1][0].askTs
		expect(sentinel).not.toBe(0)
		expect(sentinel).toBeLessThan(0)
	})

	it("a stale result shows the notice and keeps the draft and attachments", async () => {
		askResponse.mockResolvedValue({ stale: true })
		const st = askState(10)
		const { result } = renderHook(() => useMessageHandlers([], st))
		await act(async () => {
			await result.current.executeButtonAction("approve", "my feedback", [], [])
		})
		expect(st.setAskNotice).toHaveBeenCalledWith(STALE_ASK_NOTICE)
		expect(STALE_ASK_NOTICE).toBe("That request changed \u2014 review again")
		expect(st.setInputValue).not.toHaveBeenCalled()
		expect(st.setSelectedImages).not.toHaveBeenCalled()
	})

	it("a stale reply through handleSendMessage keeps the draft and does not lock the input", async () => {
		askResponse.mockResolvedValue({ stale: true })
		const st = askState(10)
		const { result } = renderHook(() => useMessageHandlers([{ ts: 1, type: "say", say: "task", text: "t" }] as any, st))
		await act(async () => {
			await result.current.handleSendMessage("hello", [], [])
		})
		expect(st.setAskNotice).toHaveBeenCalledWith(STALE_ASK_NOTICE)
		expect(st.setInputValue).not.toHaveBeenCalled()
		expect(st.setSendingDisabled).not.toHaveBeenCalled()
	})

	it("a fresh result clears the draft as before", async () => {
		const st = askState(10)
		const { result } = renderHook(() => useMessageHandlers([], st))
		await act(async () => {
			await result.current.executeButtonAction("approve", "ok")
		})
		expect(st.setAskNotice).not.toHaveBeenCalled()
		expect(st.setInputValue).toHaveBeenCalledWith("")
	})
})
