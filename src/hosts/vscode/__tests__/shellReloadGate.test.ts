import { expect } from "chai"
import { pruneNestedRoots, rootsKey, ShellReloadGate } from "../shellReloadGate"

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

describe("pruneNestedRoots", () => {
	const root = (path: string, scheme = "file", authority = "") => ({
		scheme,
		authority,
		path,
		toString: () => `${scheme}://${authority}${path}`,
	})

	it("drops a directory inside another root", () => {
		const pack = root("/home/u/packs/hmfp")
		const roots = [pack, root("/home/u/packs/hmfp/modules/04"), root("/home/u/packs/hmfp/modules/05"), root("/ws")]
		expect(pruneNestedRoots(roots)).to.deep.equal([pack, roots[3]])
	})

	it("keeps the root set identical as module directories are opened under a pack root", () => {
		const pack = root("/p/pack")
		const key = (modules: string[]) => rootsKey(pruneNestedRoots([pack, ...modules.map((m) => root(`/p/pack/modules/${m}`))]))
		expect(key([])).to.equal(key(["01"]))
		expect(key(["01"])).to.equal(key(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]))
	})

	it("matches whole path segments, not string prefixes", () => {
		const roots = [root("/p/pack"), root("/p/pack-two")]
		expect(pruneNestedRoots(roots)).to.have.length(2)
	})

	it("keeps roots of another scheme or authority and keeps one of two duplicates", () => {
		const a = root("/p/pack")
		const otherScheme = root("/p/pack/x", "vscode-remote", "host")
		expect(pruneNestedRoots([a, otherScheme])).to.have.length(2)
		expect(pruneNestedRoots([root("/p/pack"), root("/p/pack/")])).to.have.length(1)
	})

	it("never keeps less access: every dropped root lies under a kept one", () => {
		const roots = [root("/a/b/c"), root("/a/b"), root("/a/b/c/d"), root("/z")]
		const kept = pruneNestedRoots(roots)
		expect(kept.map((r) => r.path)).to.have.members(["/a/b", "/z"])
	})

	it("keeps Windows drive-letter roots apart and prunes within a drive", () => {
		const c = root("/c:/packs/hmfp")
		const inner = root("/c:/packs/hmfp/modules/04")
		const d = root("/d:/packs/hmfp/modules/04")
		expect(pruneNestedRoots([c, inner, d])).to.deep.equal([c, d])
	})

	it("does not treat a path with .. segments as contained", () => {
		// URIs are normalised by VS Code, but a literal ".." must never be read as inside the parent.
		const pack = root("/p/pack")
		const escape = root("/p/pack/../other")
		expect(pruneNestedRoots([pack, escape])).to.have.length(2)
	})
})
