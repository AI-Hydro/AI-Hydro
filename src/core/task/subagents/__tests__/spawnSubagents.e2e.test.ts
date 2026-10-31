import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { parseSubagentStatus } from "@shared/aihydro/subagents"
import type { AiHydroAsk, AiHydroSay } from "@shared/ExtensionMessage"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { TaskState } from "../../TaskState"
import { ToolExecutor } from "../../ToolExecutor"
import { SpawnSubagentsToolHandler } from "../../tools/handlers/SpawnSubagentsToolHandler"
import { ChildMessageState } from "../childRuntime"
import { makeParent, type ParentHarness, scriptedApi, tool } from "./subagentHarness"

const report = (summary: string) => tool("report_findings", { summary })

async function waitFor(condition: () => boolean, ms = 3000): Promise<void> {
	const deadline = Date.now() + ms
	while (!condition()) {
		if (Date.now() > deadline) {
			throw new Error("timed out waiting for a condition")
		}
		await new Promise((r) => setTimeout(r, 10))
	}
}

/**
 * End to end through the real parent path: a spawn_subagents tool call -> the real ToolExecutor -> the real handler ->
 * the real supervisor, runners, child executors and ask bridge. Only the model (scripted) and the user (answered by
 * the test) are fake. This is the scenario the owner asked for: a parent spawns explorers, one tries a write and is
 * refused, one is cancelled.
 */
describe("spawn_subagents end to end", () => {
	let h: ParentHarness
	let taskState: TaskState
	let messages: ChildMessageState // an in-memory message list standing in for the parent's
	let parentSays: Array<{ type: AiHydroSay; text?: string }>
	let lastMessageTs: number
	let executor: ToolExecutor
	let childApis: any[]

	function parentExecutor(): ToolExecutor {
		const stateManager = h.runnerBase.stateManager as any
		const ask = async (type: AiHydroAsk, text?: string, _partial?: boolean, meta?: any) => {
			lastMessageTs = Date.now() + h.asks.length + 1
			await messages.addToAiHydroMessages({
				ts: lastMessageTs,
				type: "ask",
				ask: type,
				text,
				...(meta?.subagentOrigin ? { subagentOrigin: meta.subagentOrigin } : {}),
			})
			h.asks.push({ type, text, meta })
			return h.answer({ type, text, meta }) as any
		}
		const say = async (type: AiHydroSay, text?: string) => {
			parentSays.push({ type, text })
			lastMessageTs = Date.now() + 1_000 + parentSays.length
			await messages.addToAiHydroMessages({ ts: lastMessageTs, type: "say", say: type, text })
			return lastMessageTs
		}
		const exec = new ToolExecutor(
			{ extension: { extensionPath: "/mock" } } as any,
			taskState,
			messages,
			scriptedApi([]),
			{} as any,
			{ closeBrowser: async () => {} } as any,
			{} as any,
			h.mcp as any,
			{ trackFileContext: async () => {} } as any,
			h.runnerBase.aihydroIgnoreController,
			{} as any,
			stateManager,
			h.runnerBase.services.controller,
			h.dir,
			"task-1",
			"ulid-parent",
			undefined,
			false,
			say,
			ask as any,
			async () => {},
			async () => ({}),
			async () => {},
			async () => [false, ""],
			async () => false,
			async () => {},
			async () => false,
		)
		// Production builds each child's handler from the user's API settings; the test hands out scripted ones.
		;(exec as any).coordinator.register(new SpawnSubagentsToolHandler({ buildApi: () => childApis.shift() }))
		return exec
	}

	const childStatuses = () =>
		parseSubagentStatus(messages.getAiHydroMessages().find((m) => m.say === "subagent_status")?.text)?.children.map(
			(c) => c.status,
		) ?? []

	const spawn = (prompts: string[]) => ({
		type: "tool_use" as const,
		name: "spawn_subagents" as any,
		params: { prompts: JSON.stringify(prompts) },
		partial: false,
	})
	const resultText = () =>
		taskState.userMessageContent
			.map((part: any) => part.text)
			.filter(Boolean)
			.join("\n")

	beforeEach(() => {
		fs.rmSync(path.join(os.tmpdir(), "aihydro-sub-storage", "tasks", "task-1"), { recursive: true, force: true })
		h = makeParent()
		h.settings.subagentsEnabled = true
		taskState = new TaskState()
		messages = new ChildMessageState("task-1", "ulid-parent", taskState)
		parentSays = []
		lastMessageTs = 0
		childApis = []
		executor = parentExecutor()
	})
	afterEach(() => h.cleanup())

	it("a parent spawns explorers: one writes (refused), one is cancelled, one reports; the launch is always asked", async () => {
		// Even with YOLO and every auto-approve switch on, the launch asks.
		h.settings.yoloModeToggled = true
		const hang = scriptedApi([], { hang: true })
		childApis.push(
			scriptedApi([tool("read_file", { path: "src/model.py" }), report("model.py defines nse().")]),
			scriptedApi([
				tool("write_to_file", { path: "evil.txt", content: "x" }),
				tool("execute_command", { command: "touch evil2.txt", requires_approval: "false" }),
				report("Read-only: I could not write."),
			]),
			hang,
		)

		const done = executor.executeTool(spawn(["What does model.py do?", "Create evil.txt", "Survey everything"]))
		// Explorers 1 and 2 finish; explorer 3 is still waiting on its model. Stop the task.
		await waitFor(() => h.mcp !== undefined && childStatuses().filter((s) => s === "completed").length === 2)
		taskState.abort = true
		await done
		const text = resultText()

		// 1. The launch was asked, with the prompts, before any child existed.
		const launch = h.asks[0]
		expect(launch.type).to.equal("tool")
		expect(launch.meta?.subagentOrigin).to.equal(undefined)
		const launchTool = JSON.parse(launch.text!)
		expect(launchTool.tool).to.equal("spawnSubagents")
		expect(launchTool.subagents.prompts).to.deep.equal(["What does model.py do?", "Create evil.txt", "Survey everything"])
		expect(launchTool.subagents.limits).to.include("No file writes")

		// 2. The write and the command never ran.
		expect(fs.existsSync(path.join(h.dir, "evil.txt"))).to.equal(false)
		expect(fs.existsSync(path.join(h.dir, "evil2.txt"))).to.equal(false)

		// 3. The parent got one untrusted-wrapped result with all three endings.
		expect(text).to.match(/<subagent_reports untrusted="true">/)
		expect(text).to.include("model.py defines nse()")
		expect(text).to.include("Read-only: I could not write.")
		expect(text.match(/status="completed"/g)).to.have.length(2)
		expect(text.match(/status="cancelled"/g)).to.have.length(1)

		// 4. One status row, added once with `say`, then only mutated in place: the parent's own `say` was used once.
		expect(parentSays.map((say) => say.type)).to.deep.equal(["subagent_status"])
		const row = messages.getAiHydroMessages().find((m) => m.say === "subagent_status")!
		const status = parseSubagentStatus(row.text)!
		expect(status.done).to.equal(true)
		expect(status.children.map((c) => c.status)).to.deep.equal(["completed", "completed", "cancelled"])
		expect(status.children[1].calls.map((c) => c.result)).to.deep.equal(["refused", "refused", "ok"])

		// 5. A record per child on disk (the real writer), including the cancelled one; the report path is in the result.
		const dir = path.join(os.tmpdir(), "aihydro-sub-storage", "tasks", "task-1", "subagents")
		const records = fs.readdirSync(dir).map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")))
		expect(records.map((r: any) => r.status).sort()).to.deep.equal(["cancelled", "completed", "completed"])
		for (const record of records) {
			expect(text).to.include(`record="subagents/${record.childId}.json"`)
			expect(record.parentUlid).to.equal("ulid-parent")
		}
	})

	it("a denied launch starts nothing", async () => {
		h.answer = async () => ({ response: "noButtonClicked" })
		const done = executor.executeTool(spawn(["x"]))
		await done
		expect(resultText()).to.match(/denied|did not|rejected/i)
		expect(h.records).to.have.length(0)
		expect(parentSays).to.have.length(0)
		expect(childApis).to.have.length(0)
	})

	it("a child's approval is the parent's ask, one at a time, first in first out", async () => {
		h.settings.autoApprovalSettings = { ...(h.settings.autoApprovalSettings as object), enabled: false }
		const gates: Array<() => void> = []
		h.answer = (ask) => {
			if (!ask.meta?.subagentOrigin) {
				return Promise.resolve({ response: "yesButtonClicked" }) // the launch
			}
			return new Promise((resolve) => gates.push(() => resolve({ response: "yesButtonClicked" })))
		}
		childApis.push(
			scriptedApi([tool("read_file", { path: "README.md" }), report("one")]),
			scriptedApi([tool("read_file", { path: "src/model.py" }), report("two")]),
		)
		const done = executor.executeTool(spawn(["a", "b"]))
		await waitFor(() => h.asks.some((ask) => ask.meta?.subagentOrigin) && childStatuses().includes("waiting"))

		// Both children want a read approved; exactly one is pending at the parent, and the parent `say` count is unchanged.
		const childAsks = h.asks.filter((ask) => ask.meta?.subagentOrigin)
		expect(childAsks).to.have.length(1)
		expect(childAsks[0].meta?.subagentOrigin?.label).to.equal("Explorer 1")
		expect(parentSays.map((s) => s.type)).to.deep.equal(["subagent_status"])
		expect(childStatuses()).to.include("waiting")

		gates.shift()!()
		await waitFor(() => h.asks.filter((ask) => ask.meta?.subagentOrigin).length === 2)
		expect(h.asks.filter((ask) => ask.meta?.subagentOrigin).map((a) => a.meta?.subagentOrigin?.label)).to.deep.equal([
			"Explorer 1",
			"Explorer 2",
		])
		gates.shift()!()
		await done
		expect(resultText()).to.include('status="completed"')
	})

	it("Stop while a child's approval is pending ends every child as cancelled and returns the call", async () => {
		h.settings.autoApprovalSettings = { ...(h.settings.autoApprovalSettings as object), enabled: false }
		h.answer = (ask) => (ask.meta?.subagentOrigin ? new Promise(() => {}) : Promise.resolve({ response: "yesButtonClicked" })) // the user never answers a child ask
		childApis.push(scriptedApi([tool("read_file", { path: "README.md" }), report("one")]), scriptedApi([], { hang: true }))
		const done = executor.executeTool(spawn(["a", "b"]))
		await waitFor(() => childStatuses().includes("waiting"))
		taskState.abort = true
		await done
		expect(resultText()).to.include('status="cancelled"')
		expect(resultText().match(/status="cancelled"/g)).to.have.length(2)
		expect(parseSubagentStatus(messages.getAiHydroMessages().find((m) => m.say === "subagent_status")?.text)?.done).to.equal(
			true,
		)
	})

	it("is refused when the setting is off: not in the registry, and an explicit result", async () => {
		h.settings.subagentsEnabled = false
		const block = spawn(["x"])
		await executor.executeTool(block)
		expect(resultText()).to.include("Subagents are turned off")
		expect((executor as any).coordinator.has("spawn_subagents")).to.equal(false)
		expect(h.asks).to.have.length(0)
		expect(h.records).to.have.length(0)
	})

	it("bad requests are told what is wrong and nothing runs", async () => {
		for (const params of [
			{},
			{ prompts: "[]" },
			{ prompts: '["a","b","c","d","e"]' },
			{ prompts: "[1,2]" },
			{ prompts: '["a"]', profile: "general" },
		]) {
			taskState.userMessageContent = []
			taskState.didAlreadyUseTool = false
			await executor.executeTool({
				type: "tool_use",
				name: "spawn_subagents" as any,
				params: params as any,
				partial: false,
			})
			expect(resultText(), JSON.stringify(params)).to.match(/prompts|profile|At most/)
		}
		expect(h.asks).to.have.length(0)
	})

	it("the spawn tool is absent from a child's registry and refused if a child names it", async () => {
		const { SubagentRunner } = await import("../SubagentRunner")
		const { capFor } = await import("../agentProfile")
		const { PARENT_CAPS, PROFILE } = await import("./subagentHarness")
		const runner = new SubagentRunner({
			...h.runnerBase,
			childId: "sa_x",
			ordinal: 1,
			label: "Explorer 1",
			profile: "explorer",
			caps: capFor(PARENT_CAPS, PROFILE)!,
			prompt: "p",
			api: scriptedApi([tool("spawn_subagents", { prompts: '["nested"]' }), report("done")]),
		} as any)
		const result = await runner.run()
		expect(result.status).to.equal("completed")
		expect(h.records[0].toolCalls[0]).to.include({ name: "spawn_subagents", result: "refused" })
		expect(h.asks).to.have.length(0)
	})
})
