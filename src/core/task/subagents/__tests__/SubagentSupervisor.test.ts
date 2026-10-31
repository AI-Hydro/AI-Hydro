import * as fs from "node:fs"
import * as path from "node:path"
import type { SubagentChildSummary } from "@shared/aihydro/subagents"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { MAX_CONCURRENT_CHILDREN, SpawnRefused, SubagentSupervisor } from "../SubagentSupervisor"
import { formatReportsForParent } from "../subagentReports"
import { makeParent, PARENT_CAPS, type ParentHarness, PROFILE, scriptedApi, tool } from "./subagentHarness"

const report = (summary: string) => tool("report_findings", { summary })

function supervisorFor(h: ParentHarness, apis: any[], overrides: Record<string, unknown> = {}) {
	let next = 0
	const updates: string[][] = []
	const supervisor = new SubagentSupervisor({
		profile: PROFILE,
		parent: PARENT_CAPS,
		runnerBase: h.runnerBase,
		buildApi: () => apis[next++],
		onUpdate: (children: SubagentChildSummary[]) => updates.push(children.map((c) => c.status)),
		newId: (() => {
			let n = 0
			return () => `sa_${++n}`
		})(),
		...overrides,
	} as any)
	return { supervisor, updates }
}

describe("SubagentSupervisor", () => {
	let h: ParentHarness
	beforeEach(() => {
		h = makeParent()
	})
	afterEach(() => h.cleanup())

	it("END TO END: the parent spawns explorers; one tries a write and is refused; one is cancelled; the rest report", async () => {
		const hang = scriptedApi([], { hang: true })
		const apis = [
			// Explorer 1: reads, calls a READ MCP tool, reports.
			scriptedApi([
				tool("read_file", { path: "src/model.py" }),
				tool("use_mcp_tool", { server_name: "ai-hydro", tool_name: "get_session_summary", arguments: "{}" }),
				report("model.py defines nse(); the session summary is available."),
			]),
			// Explorer 2: tries to write a file and to run a command, is refused both times, then reports honestly.
			scriptedApi([
				tool("write_to_file", { path: "evil.txt", content: "pwn" }),
				tool("execute_command", { command: "touch evil2.txt", requires_approval: "false" }),
				report("I could not write; the profile is read-only."),
			]),
			// Explorer 3: hangs on its model until it is cancelled.
			hang,
		]
		const { supervisor, updates } = supervisorFor(h, apis)

		const running = supervisor.run(["What does src/model.py do?", "Add a file evil.txt", "Survey the repo"])
		await new Promise((r) => setTimeout(r, 150))
		const cancelStarted = Date.now()
		expect(supervisor.cancel("sa_3")).to.equal(true)
		const results = await running

		expect(results.map((r) => r.status)).to.deep.equal(["completed", "completed", "cancelled"])
		expect(Date.now() - cancelStarted).to.be.lessThan(2000) // AC6

		// The write and the command never ran, and the user was never asked about them.
		expect(fs.existsSync(path.join(h.dir, "evil.txt"))).to.equal(false)
		expect(fs.existsSync(path.join(h.dir, "evil2.txt"))).to.equal(false)
		const record2 = h.records.find((r) => r.childId === "sa_2")!
		expect(record2.toolCalls.map((c) => c.result)).to.deep.equal(["refused", "refused", "ok"])
		// The only thing that reached the user is Explorer 1's MCP call (no stored "Always" grant), shown as the parent's ask.
		expect(h.asks.map((a) => [a.type, a.meta?.subagentOrigin?.label])).to.deep.equal([["use_mcp_server", "Explorer 1"]])

		// The READ MCP call ran once, under the parent's chat id, and nothing else reached the server.
		expect(h.mcp.calls.map((c) => c.tool)).to.deep.equal(["get_session_summary"])
		expect((h.mcp.calls[0].meta as any)["aihydro/context"].chat_id).to.equal("ulid-parent")

		// Every child has a record, including the cancelled one.
		expect(h.records.map((r) => [r.childId, r.status]).sort()).to.deep.equal([
			["sa_1", "completed"],
			["sa_2", "completed"],
			["sa_3", "cancelled"],
		])
		// The parent's say was never used and the status stream shows queued -> running -> final.
		expect(h.parentSays).to.equal(0)
		expect(updates[0]).to.deep.equal(["queued", "queued", "queued"])
		expect(updates.at(-1)).to.deep.equal(["completed", "completed", "cancelled"])

		// What the parent receives is wrapped as untrusted data.
		const text = formatReportsForParent(results)
		expect(text).to.include('untrusted="true"')
		expect(text).to.include("model.py defines nse()")
		expect(text).to.include('status="cancelled"')
	})

	it("runs at most three at once and queues the fourth", async () => {
		let live = 0
		let maxLive = 0
		const make = () => {
			const api = scriptedApi([report("ok")])
			const create = api.createMessage.bind(api)
			api.createMessage = ((system: string, history: any[]) => {
				const stream = create(system, history)
				return (async function* () {
					live++
					maxLive = Math.max(maxLive, live)
					await new Promise((r) => setTimeout(r, 40))
					try {
						yield* stream
					} finally {
						live--
					}
				})()
			}) as any
			return api
		}
		const { supervisor, updates } = supervisorFor(h, [make(), make(), make(), make()])
		const results = await supervisor.run(["a", "b", "c", "d"])
		expect(results.map((r) => r.status)).to.deep.equal(["completed", "completed", "completed", "completed"])
		expect(maxLive).to.equal(MAX_CONCURRENT_CHILDREN)
		expect(updates.some((u) => u[3] === "queued" && u.slice(0, 3).includes("running"))).to.equal(true)
	})

	it("Stop (the parent aborting) cancels every child, queued ones included, within 2 seconds", async () => {
		const apis = [0, 1, 2, 3].map(() => scriptedApi([], { hang: true }))
		const { supervisor } = supervisorFor(h, apis)
		const running = supervisor.run(["a", "b", "c", "d"])
		await new Promise((r) => setTimeout(r, 100))
		const started = Date.now()
		h.aborted = true
		supervisor.cancelAll()
		const results = await running
		expect(results.map((r) => r.status)).to.deep.equal(["cancelled", "cancelled", "cancelled", "cancelled"])
		expect(Date.now() - started).to.be.lessThan(2000)
		expect(apis[3].requests).to.equal(0) // the queued child never made a request
		expect(h.records).to.have.length(4)
	})

	it("AC4 end to end: two children asking at once give one pending parent ask, FIFO, with distinct origins", async () => {
		h.settings.autoApprovalSettings = { ...(h.settings.autoApprovalSettings as object), enabled: false }
		const pending: Array<() => void> = []
		let live = 0
		let maxLive = 0
		h.answer = (ask) =>
			new Promise((resolve) => {
				live++
				maxLive = Math.max(maxLive, live)
				pending.push(() => {
					live--
					resolve({ response: "yesButtonClicked" })
				})
				void ask
			})
		const apis = [
			scriptedApi([tool("read_file", { path: "README.md" }), report("one")]),
			scriptedApi([tool("read_file", { path: "src/model.py" }), report("two")]),
		]
		const { supervisor } = supervisorFor(h, apis)
		const running = supervisor.run(["a", "b"])
		await new Promise((r) => setTimeout(r, 100))
		expect(h.asks).to.have.length(1)
		expect(h.asks[0].meta?.subagentOrigin?.label).to.equal("Explorer 1")
		pending.shift()!()
		await new Promise((r) => setTimeout(r, 100))
		expect(h.asks).to.have.length(2)
		expect(h.asks[1].meta?.subagentOrigin?.label).to.equal("Explorer 2")
		pending.shift()!()
		const results = await running
		expect(maxLive).to.equal(1)
		expect(results.map((r) => r.status)).to.deep.equal(["completed", "completed"])
	})

	it("refuses an empty request, more than four prompts, and a spawn from a child", async () => {
		const { supervisor } = supervisorFor(h, [])
		for (const bad of [[], [""], ["a", "  "], ["a", "b", "c", "d", "e"]]) {
			const error = await supervisor.run(bad).catch((e) => e)
			expect(error, JSON.stringify(bad)).to.be.instanceOf(SpawnRefused)
		}
		expect(() => supervisorFor(h, [], { parent: { ...PARENT_CAPS, parentIsChild: true } })).to.throw(SpawnRefused)
	})
})
