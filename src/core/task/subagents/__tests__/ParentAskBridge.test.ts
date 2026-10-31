import type { SubagentOrigin } from "@shared/aihydro/subagents"
import { expect } from "chai"
import { describe, it } from "mocha"
import { ChildAskRefused, type ParentAsk, ParentAskBridge } from "../ParentAskBridge"

const origin = (n: number): SubagentOrigin => ({
	childId: `sa_${n}`,
	label: `Explorer ${n}`,
	profile: "explorer",
	promptHead: `task ${n}`,
})

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((r) => (resolve = r))
	return { promise, resolve }
}

describe("ParentAskBridge", () => {
	it("AC4: two children asking at once produce exactly one pending parent ask, in FIFO order", async () => {
		const gates = [deferred<void>(), deferred<void>(), deferred<void>()]
		const order: string[] = []
		let live = 0
		let maxLive = 0
		let call = 0
		const parentAsk: ParentAsk = async (_type, text, _partial, meta) => {
			const mine = call++
			live++
			maxLive = Math.max(maxLive, live)
			order.push(`${meta?.subagentOrigin?.childId}:${text}`)
			await gates[mine].promise
			live--
			return { response: "yesButtonClicked" }
		}
		const bridge = new ParentAskBridge(parentAsk, () => false)

		const a = bridge.ask(origin(1), "tool", "a")
		const b = bridge.ask(origin(2), "tool", "b")
		const c = bridge.ask(origin(1), "use_mcp_server", "c")
		await new Promise((r) => setTimeout(r, 20))
		expect(order).to.deep.equal(["sa_1:a"]) // only the first is pending
		expect(bridge.depth).to.equal(3)

		gates[0].resolve()
		await a
		await new Promise((r) => setTimeout(r, 20))
		expect(order).to.deep.equal(["sa_1:a", "sa_2:b"])
		gates[1].resolve()
		await b
		gates[2].resolve()
		await c
		expect(order).to.deep.equal(["sa_1:a", "sa_2:b", "sa_1:c"])
		expect(maxLive).to.equal(1)
		expect(bridge.depth).to.equal(0)
	})

	it("stamps the origin from the runner's identity and forwards a complete ask (partial is not forwarded)", async () => {
		const seen: any[] = []
		const bridge = new ParentAskBridge(
			async (...args) => {
				seen.push(args)
				return { response: "yesButtonClicked" }
			},
			() => false,
		)
		await bridge.ask(origin(3), "tool", "t", false)
		expect(seen[0][0]).to.equal("tool")
		expect(seen[0][2]).to.equal(undefined)
		expect(seen[0][3]).to.deep.equal({ subagentOrigin: origin(3) })
	})

	it("drops partial asks", async () => {
		let called = false
		const bridge = new ParentAskBridge(
			async () => {
				called = true
				return { response: "yesButtonClicked" }
			},
			() => false,
		)
		const error = await bridge.ask(origin(1), "tool", "t", true).catch((e) => e)
		expect(error).to.be.instanceOf(ChildAskRefused)
		expect(called).to.equal(false)
	})

	it("refuses every ask type but tool and use_mcp_server (command, followup, completion_result, new_task, ...)", async () => {
		let called = false
		const bridge = new ParentAskBridge(
			async () => {
				called = true
				return { response: "yesButtonClicked" }
			},
			() => false,
		)
		for (const type of [
			"command",
			"followup",
			"completion_result",
			"new_task",
			"plan_mode_respond",
			"browser_action_launch",
			"report_bug",
			"condense",
			"api_req_failed",
			"resume_task",
		] as const) {
			const error = await bridge.ask(origin(1), type, "x").catch((e) => e)
			expect(error, type).to.be.instanceOf(ChildAskRefused)
		}
		expect(called).to.equal(false)
	})

	it("a failed ask does not wedge the queue", async () => {
		let n = 0
		const bridge = new ParentAskBridge(
			async () => {
				if (n++ === 0) {
					throw new Error("superseded")
				}
				return { response: "yesButtonClicked" }
			},
			() => false,
		)
		const first = await bridge.ask(origin(1), "tool", "a").catch((e) => e)
		expect(first).to.be.instanceOf(Error)
		expect((await bridge.ask(origin(2), "tool", "b")).response).to.equal("yesButtonClicked")
	})

	it("does not ask the parent once it is aborted", async () => {
		let aborted = false
		let called = 0
		const bridge = new ParentAskBridge(
			async () => {
				called++
				return { response: "yesButtonClicked" }
			},
			() => aborted,
		)
		await bridge.ask(origin(1), "tool", "a")
		aborted = true
		const error = await bridge.ask(origin(1), "tool", "b").catch((e) => e)
		expect(error.message).to.include("aborted")
		expect(called).to.equal(1)
	})
})
