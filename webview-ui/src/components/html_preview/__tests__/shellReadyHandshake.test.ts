import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { startShellReadyHandshake } from "../shellReadyHandshake"

describe("startShellReadyHandshake", () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	it("keeps asking the host until the shell has its state (a lost first reply is recovered)", () => {
		const post = vi.fn()
		let ready = false
		startShellReadyHandshake({ getToken: () => "tok-a", post, isReady: () => ready, intervalMs: 1000 })

		vi.advanceTimersByTime(0)
		expect(post).toHaveBeenCalledTimes(1)
		expect(post).toHaveBeenLastCalledWith({ type: "aihydro-shell-ready", token: "tok-a" })

		// The host's first re-push never arrived: the shell is still not ready, so it asks again.
		vi.advanceTimersByTime(1000)
		expect(post).toHaveBeenCalledTimes(2)

		// The second re-push landed.
		ready = true
		vi.advanceTimersByTime(5000)
		expect(post).toHaveBeenCalledTimes(2)
	})

	it("sends nothing when the shell is already ready or has no panel token", () => {
		const post = vi.fn()
		startShellReadyHandshake({ getToken: () => "tok", post, isReady: () => true })
		startShellReadyHandshake({ getToken: () => undefined, post, isReady: () => false })
		vi.advanceTimersByTime(10_000)
		expect(post).not.toHaveBeenCalled()
	})

	it("two mounts each identify themselves with their own token, and unmounting stops one", () => {
		const post = vi.fn()
		const stopOld = startShellReadyHandshake({ getToken: () => "old", post, isReady: () => false, intervalMs: 500 })
		startShellReadyHandshake({ getToken: () => "new", post, isReady: () => false, intervalMs: 500 })
		vi.advanceTimersByTime(0)
		expect(post.mock.calls.map((c) => c[0].token).sort()).toEqual(["new", "old"])

		stopOld()
		post.mockClear()
		vi.advanceTimersByTime(500)
		expect(post.mock.calls.map((c) => c[0].token)).toEqual(["new"])
	})

	it("gives up after the attempt cap", () => {
		const post = vi.fn()
		startShellReadyHandshake({ getToken: () => "t", post, isReady: () => false, intervalMs: 10, maxAttempts: 3 })
		vi.advanceTimersByTime(10_000)
		expect(post).toHaveBeenCalledTimes(3)
	})
})
