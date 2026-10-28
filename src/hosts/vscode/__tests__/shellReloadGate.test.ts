import { expect } from "chai"
import { ShellReloadGate, rootsKey } from "../shellReloadGate"

function makeGate(settleTimeoutMs = 10_000) {
	const applied: number[] = []
	const timers: { fn: () => void; ms: number; cancelled: boolean }[] = []
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
	)
	return { gate, applied, timers }
}

describe("ShellReloadGate", () => {
	it("applies the first request immediately", () => {
		const { gate, applied } = makeGate()
		gate.request()
		expect(applied).to.have.length(1)
		expect(gate.isLoading).to.equal(true)
	})

	it("treats the initial html load as in flight, so an early request waits for the first shell", () => {
		const { gate, applied } = makeGate()
		gate.markLoading()
		gate.request()
		expect(applied).to.have.length(0)
		gate.shellReady("doc-1")
		expect(applied).to.have.length(1)
	})

	it("never stacks content updates: requests while a document loads coalesce into one follow-up", () => {
		// The failing ordering on Windows: several artifact changes land while the first shell is loading.
		const { gate, applied } = makeGate()
		gate.request()
		gate.request()
		gate.request()
		expect(applied).to.have.length(1)

		gate.shellReady("doc-1")
		expect(applied).to.have.length(2)

		gate.request()
		expect(applied).to.have.length(2)
		gate.shellReady("doc-2")
		expect(applied).to.have.length(3)
		gate.shellReady("doc-3")
		expect(gate.isLoading).to.equal(false)
		expect(applied).to.have.length(3)
	})

	it("does not settle on repeats from a document it already heard from", () => {
		const { gate, applied } = makeGate()
		gate.request()
		gate.shellReady("doc-1")
		expect(gate.isLoading).to.equal(false)
		gate.request()
		expect(applied).to.have.length(2)
		// The settled document's handshake keeps asking until it has state; that is not the new document.
		gate.shellReady("doc-1")
		gate.request()
		expect(applied).to.have.length(2)
		gate.shellReady("doc-2")
		expect(applied).to.have.length(3)
	})

	it("ignores ready messages without an instance id", () => {
		const { gate } = makeGate()
		gate.request()
		gate.shellReady(undefined)
		gate.shellReady("")
		gate.shellReady(7)
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
		const { gate, timers } = makeGate()
		gate.request()
		gate.shellReady("doc-1")
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
