import { expect } from "chai"
import { rootsKey, ShellReloadGate } from "../shellReloadGate"

function makeGate(settleTimeoutMs = 10_000) {
	const applied: number[] = []
	const timers: { fn: () => void; ms: number; cancelled: boolean }[] = []
	const clock = { t: 1_000 }
	const gate = new ShellReloadGate(
		() => applied.push(applied.length + 1),
		(fn, ms) => {
			const timer = { fn, ms, cancelled: false }
			timers.push(timer)
			return () => {
				timer.cancelled = true
			}
		},
		settleTimeoutMs,
		() => clock.t,
	)
	return { gate, applied, timers, clock }
}

describe("ShellReloadGate", () => {
	it("applies the first request immediately", () => {
		const { gate, applied } = makeGate()
		gate.request()
		expect(applied).to.have.length(1)
		expect(gate.isLoading).to.equal(true)
	})

	it("treats the initial html load as in flight, so an early request waits for the first shell", () => {
		const { gate, applied, clock } = makeGate()
		gate.markLoading()
		gate.request()
		expect(applied).to.have.length(0)
		clock.t += 10
		gate.shellReady("doc-1", clock.t)
		expect(applied).to.have.length(1)
	})

	it("never stacks content updates: requests while a document loads coalesce into one follow-up", () => {
		// The failing ordering on Windows: several artifact changes land while the first shell is loading.
		const { gate, applied, clock } = makeGate()
		gate.request()
		gate.request()
		gate.request()
		expect(applied).to.have.length(1)

		clock.t += 10
		gate.shellReady("doc-1", clock.t)
		expect(applied).to.have.length(2)

		gate.request()
		expect(applied).to.have.length(2)
		clock.t += 10
		gate.shellReady("doc-2", clock.t)
		expect(applied).to.have.length(3)
		clock.t += 10
		gate.shellReady("doc-3", clock.t)
		expect(gate.isLoading).to.equal(false)
		expect(applied).to.have.length(3)
	})

	it("a late ready from a document that loaded before the reload began does not release the gate", () => {
		const { gate, applied, clock } = makeGate()
		gate.request()
		clock.t += 10
		const oldDocLoadedAt = clock.t - 5
		gate.shellReady("doc-1", clock.t)
		expect(gate.isLoading).to.equal(false)

		// A reload starts; doc-1 (being replaced) has not been heard from again, then reports late.
		clock.t += 100
		gate.request()
		gate.request()
		expect(applied).to.have.length(2)
		gate.shellReady("doc-1", oldDocLoadedAt)
		// A document that first reports now but was loaded before the reload began is not the new one either.
		gate.shellReady("doc-0", oldDocLoadedAt - 50)
		expect(gate.isLoading).to.equal(true)
		expect(applied).to.have.length(2)

		// The document that really loaded after the reload releases it, and the coalesced follow-up runs.
		clock.t += 20
		gate.shellReady("doc-2", clock.t)
		expect(applied).to.have.length(3)
	})

	it("ignores ready messages without an instance id or load stamp", () => {
		const { gate, clock } = makeGate()
		gate.request()
		clock.t += 10
		gate.shellReady(undefined, clock.t)
		gate.shellReady("", clock.t)
		gate.shellReady(7, clock.t)
		gate.shellReady("doc-1")
		gate.shellReady("doc-1", "now")
		expect(gate.isLoading).to.equal(true)
	})

	it("the watchdog releases a gate whose document never reports", () => {
		const { gate, applied, timers } = makeGate(5_000)
		gate.request()
		gate.request()
		expect(timers[0].ms).to.equal(5_000)
		timers[0].fn()
		expect(applied).to.have.length(2)
	})

	it("cancels the watchdog once the document reports", () => {
		const { gate, timers, clock } = makeGate()
		gate.request()
		clock.t += 10
		gate.shellReady("doc-1", clock.t)
		expect(timers[0].cancelled).to.equal(true)
	})
})

describe("rootsKey", () => {
	it("is independent of order and changes when a root is added", () => {
		const a = { toString: () => "file:///a" }
		const b = { toString: () => "file:///b" }
		expect(rootsKey([a, b])).to.equal(rootsKey([b, a]))
		expect(rootsKey([a])).to.not.equal(rootsKey([a, b]))
	})
})
