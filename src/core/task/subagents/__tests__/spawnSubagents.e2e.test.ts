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
import { setWorkspaceTrustProvider } from "../../workspaceTrust"
import { userWroteToLead } from "../launchBrake"
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

	const spawn = (prompts: string[], extra: Record<string, string> = {}) => ({
		type: "tool_use" as const,
		name: "spawn_subagents" as any,
		params: { prompts: JSON.stringify(prompts), ...extra },
		partial: false,
	})
	const resultText = () =>
		taskState.userMessageContent
			.map((part: any) => part.text)
			.filter(Boolean)
			.join("\n")

	/** The records the real writer left on disk, in start order (the handler uses it, not the harness's in-memory writer). */
	const diskRecords = (): any[] => {
		const dir = path.join(os.tmpdir(), "aihydro-sub-storage", "tasks", "task-1", "subagents")
		return fs.existsSync(dir)
			? fs
					.readdirSync(dir)
					.map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")))
					.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1))
			: []
	}

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
		const { capFor } = await import("../agentDefinition")
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

	describe("task-level agent budget (agentBudgetUsd)", () => {
		const priced = { inputPrice: 3, outputPrice: 15 }
		const costing = (usd: number) =>
			scriptedApi([{ text: report("done"), usage: { inputTokens: 10, outputTokens: 5, totalCost: usd } }], {
				modelInfo: priced,
			})
		// A new model message: what the task loop resets before the next tool call.
		const again = () => {
			taskState.userMessageContent = []
			taskState.didAlreadyUseTool = false
			taskState.didRejectTool = false
		}
		const launches = () =>
			h.asks.filter((ask) => ask.type === "tool" && !ask.meta?.subagentOrigin).map((ask) => JSON.parse(ask.text!))

		it("the cap stops the third spawn, the launch card shows the running total, and nothing is asked or started", async () => {
			h.settings.agentBudgetUsd = 1
			childApis.push(costing(0.6), costing(0.6), costing(0.6))

			await executor.executeTool(spawn(["first"]))
			expect(resultText()).to.include('status="completed"')
			again()
			await executor.executeTool(spawn(["second"]))
			expect(resultText()).to.include('status="completed"')
			again()

			const asksBefore = h.asks.length
			await executor.executeTool(spawn(["third"]))
			const text = resultText()
			expect(text).to.include("subagent budget for this task is used")
			expect(text).to.include("$1.20 of $1.00")
			expect(h.asks.length, "a refused spawn asks nothing").to.equal(asksBefore)
			expect(childApis, "no handler was built for the third").to.have.length(1)

			const [first, second] = launches()
			expect(first.subagents.taskBudget).to.include({ budgetUsd: 1, spentUsd: 0 })
			expect(second.subagents.taskBudget.spentUsd).to.be.closeTo(0.6, 1e-9)
		})

		it("defaults to $5 per task and shows it on the launch card; an unpriced model is called unknown", async () => {
			childApis.push(scriptedApi([report("done")]))
			await executor.executeTool(spawn(["only"]))
			const [launch] = launches()
			expect(launch.subagents.taskBudget).to.deep.equal({ budgetUsd: 5, spentUsd: 0, priced: false, unpricedChildren: 0 })
		})

		it("a spawn that overruns the cap stops its own siblings at their next request", async () => {
			h.settings.agentBudgetUsd = 0.5
			const expensive = scriptedApi(
				[{ text: tool("read_file", { path: "README.md" }), usage: { inputTokens: 1, outputTokens: 1, totalCost: 0.6 } }],
				{
					modelInfo: priced,
				},
			)
			childApis.push(expensive, expensive)
			await executor.executeTool(spawn(["a"]))
			expect(resultText()).to.include('status="partial"')
			expect(
				parseSubagentStatus(messages.getAiHydroMessages().find((m) => m.say === "subagent_status")?.text)?.children[0]
					.budgetStop,
			).to.equal("task_cost")
		})

		it("a zero budget refuses every spawn", async () => {
			h.settings.agentBudgetUsd = 0
			await executor.executeTool(spawn(["x"]))
			expect(resultText()).to.include("subagent budget for this task is used")
			expect(h.asks).to.have.length(0)
		})
	})

	describe("delegation: purpose, signal, facts and the denial brake", () => {
		// A new model message: what the task loop resets before the next tool call.
		const again = () => {
			taskState.userMessageContent = []
			taskState.didAlreadyUseTool = false
			taskState.didRejectTool = false
		}
		const launchCards = () =>
			h.asks.filter((ask) => ask.type === "tool" && !ask.meta?.subagentOrigin).map((ask) => JSON.parse(ask.text!).subagents)

		it("the card carries the model's purpose (capped) and signal, and the host's own facts", async () => {
			childApis.push(scriptedApi([report("done")]))
			const long = `Find where gap filling is handled.${" x".repeat(100)}`
			await executor.executeTool(spawn(["look"], { purpose: `  ${long}\n  `, signal: "BULK" }))
			const [card] = launchCards()
			expect(card.label).to.equal("Explorer")
			expect(card.signal).to.equal("bulk")
			expect(card.purpose.length).to.equal(140)
			expect(card.purpose.endsWith("…")).to.equal(true)
			expect(card.purpose).to.not.include("\n")
			expect(card.facts).to.include({ launchesSoFar: 0, deniedSoFar: 0, agentsSoFar: 0, maxAgents: 12 })
			expect(card.definition).to.include({ id: "explorer", source: "builtin" })
			expect(card.definition.sha256).to.match(/^[0-9a-f]{64}$/)
		})

		it("a missing purpose or an unknown signal does not cost a turn: the launch still asks, with nothing made up", async () => {
			childApis.push(scriptedApi([report("done")]))
			await executor.executeTool(spawn(["look"], { signal: "thoroughness" }))
			const [card] = launchCards()
			expect(card.purpose).to.equal(undefined)
			expect(card.signal).to.equal(undefined)
			expect(resultText()).to.include('status="completed"')
		})

		it("'independent' with one prompt is shown as a contradiction, not refused", async () => {
			childApis.push(scriptedApi([report("done")]))
			await executor.executeTool(spawn(["one"], { signal: "independent" }))
			expect(launchCards()[0].facts.singlePromptIndependent).to.equal(true)
			expect(resultText()).to.include('status="completed"')
		})

		it("'reads will ask you' follows read auto-approve and workspace trust, and later launches count earlier ones", async () => {
			setWorkspaceTrustProvider(() => true)
			try {
				childApis.push(scriptedApi([report("one")]), scriptedApi([report("two")]), scriptedApi([report("three")]))
				await executor.executeTool(spawn(["a"]))
				again()
				h.settings.autoApprovalSettings = {
					...(h.settings.autoApprovalSettings as object),
					actions: { readFiles: false, useMcp: false },
				}
				await executor.executeTool(spawn(["b", "c"]))
				const [first, second] = launchCards()
				expect(first.facts.readsAsk, "trusted workspace, reads auto-run").to.equal(false)
				expect(second.facts.readsAsk, "read auto-approve off").to.equal(true)
				expect(second.facts).to.include({ launchesSoFar: 1, agentsSoFar: 1 })
			} finally {
				setWorkspaceTrustProvider(undefined)
			}
		})

		it("in an untrusted workspace every child read asks, whatever the settings", async () => {
			childApis.push(scriptedApi([report("one")]))
			await executor.executeTool(spawn(["a"]))
			expect(launchCards()[0].facts.readsAsk).to.equal(true)
		})

		it("a bare denial tells the lead to stop; the second pauses launches with no card; the user writing resumes them", async () => {
			h.answer = async () => ({ response: "noButtonClicked" })
			await executor.executeTool(spawn(["x"]))
			expect(resultText()).to.include("The user denied this launch. Carry on with your own tools.")
			expect(resultText()).to.include("Do not propose explorers again")
			again()
			await executor.executeTool(spawn(["y"]))
			expect(taskState.bareLaunchDenials).to.equal(2)
			again()

			const asks = h.asks.length
			await executor.executeTool(spawn(["z"]))
			expect(resultText()).to.include("Launches are paused: the user denied two in this task.")
			expect(resultText()).to.include("Launches resume when the user next writes to you.")
			expect(h.asks.length, "a paused launch raises no card").to.equal(asks)
			expect(childApis).to.have.length(0)
			expect(taskState.consecutiveMistakeCount, "a pause is an answer, not a mistake").to.equal(0)

			// the user writes to the lead (Task.say does this on "user_feedback"): launches are asked again
			userWroteToLead(taskState)
			again()
			h.answer = async () => ({ response: "yesButtonClicked" })
			childApis.push(scriptedApi([report("done")]))
			await executor.executeTool(spawn(["w"]))
			expect(resultText()).to.include('status="completed"')
			// the card told the user how many they had denied
			expect(launchCards().at(-1).facts.deniedSoFar).to.equal(2)
		})

		it("a denial with a message is the user speaking: it reaches the lead and does not count toward the brake", async () => {
			h.answer = async () => ({ response: "noButtonClicked", text: "use one explorer, not three" })
			await executor.executeTool(spawn(["x"]))
			again()
			await executor.executeTool(spawn(["y"]))
			again()
			await executor.executeTool(spawn(["z"]))
			expect(taskState.bareLaunchDenials ?? 0).to.equal(0)
			expect(taskState.launchDenials).to.equal(3)
			expect(resultText()).to.not.include("Launches are paused")
			expect(h.asks.filter((a) => a.type === "tool")).to.have.length(3)
		})

		it("a bare denial and then an approval does not leave the brake armed past two in a row", async () => {
			let n = 0
			h.answer = async () => ({ response: n++ === 1 ? "yesButtonClicked" : "noButtonClicked" })
			childApis.push(scriptedApi([report("done")]))
			await executor.executeTool(spawn(["x"])) // denied: bare 1
			again()
			await executor.executeTool(spawn(["y"])) // approved
			expect(resultText()).to.include('status="completed"')
			expect(taskState.bareLaunchDenials).to.equal(1)
		})
	})

	describe("task agent count (maxAgentsPerTask)", () => {
		// A new model message: what the task loop resets before the next tool call.
		const again = () => {
			taskState.userMessageContent = []
			taskState.didAlreadyUseTool = false
			taskState.didRejectTool = false
		}

		it("holds for a model with no verified price, where the dollar cap cannot fire", async () => {
			h.settings.maxAgentsPerTask = 3
			childApis.push(scriptedApi([report("a")]), scriptedApi([report("b")]), scriptedApi([report("c")]))
			await executor.executeTool(spawn(["a", "b"]))
			expect(resultText()).to.include('status="completed"')
			again()
			const asks = h.asks.length
			await executor.executeTool(spawn(["c", "d"]))
			expect(resultText()).to.include("may start only 1 more")
			expect(resultText()).to.include("2 started of 3")
			expect(h.asks.length, "a refused spawn asks nothing").to.equal(asks)
			again()
			await executor.executeTool(spawn(["c"]))
			expect(resultText()).to.include('status="completed"')
			again()
			await executor.executeTool(spawn(["e"]))
			expect(resultText()).to.include("already started 3 subagents")
		})

		it("defaults to 12, and zero refuses every spawn", async () => {
			childApis.push(scriptedApi([report("a")]))
			await executor.executeTool(spawn(["a"]))
			const card = JSON.parse(h.asks.find((a) => a.type === "tool")!.text!).subagents
			expect(card.facts.maxAgents).to.equal(12)
			again()
			h.settings.maxAgentsPerTask = 0
			await executor.executeTool(spawn(["b"]))
			expect(resultText()).to.include("already started 1 subagents")
			h.settings.maxAgentsPerTask = -2
			again()
			childApis.push(scriptedApi([report("b")]))
			await executor.executeTool(spawn(["b"]))
			expect(resultText(), "a bad value falls back to the default").to.include('status="completed"')
		})
	})

	describe("reviewer and the study brief", () => {
		const reviewText = tool("report_review", {
			summary: "Checked.",
			verdicts: "unverifiable | NSE is 0.62 | nothing to read",
		})

		it("profile reviewer runs a reviewer: labelled, advisory on the card and in the lead's result, never called a review", async () => {
			childApis.push(scriptedApi([reviewText]))
			await executor.executeTool(
				spawn(["Check: NSE is 0.62"], { profile: "reviewer", signal: "independent_check", purpose: "Check one claim" }),
			)
			const card = JSON.parse(h.asks.find((a) => a.type === "tool")!.text!).subagents
			expect(card.profile).to.equal("reviewer")
			expect(card.label).to.equal("Reviewer")
			expect(card.advisory).to.include("advice from a second model run")
			const text = resultText()
			expect(text).to.include('label="Reviewer 1"')
			expect(text).to.include('<verdict kind="unverifiable">NSE is 0.62')
			expect(text).to.include("advice from a second model run")
			expect(text).to.not.match(/\breviewed\b/i)
			expect(diskRecords()[0].definition.id).to.equal("reviewer")
		})

		it("an unknown profile names the known ones", async () => {
			await executor.executeTool(spawn(["x"], { profile: "general" }))
			expect(resultText()).to.match(/Known profiles: explorer, reviewer/)
			expect(h.asks).to.have.length(0)
		})

		it("the host-built brief goes to every child in its first message, hashed in the record, and the card says so", async () => {
			taskState.projectContextBrief = "====\n\nPROJECT CONTEXT\n\nstudy s1, gauge 01031500, plan p7"
			const firstMessages: string[] = []
			const watch = () =>
				scriptedApi([report("done")], {
					onRequest: (_system, history) => firstMessages.push(history[0].content[0].text),
				})
			childApis.push(watch(), watch())
			await executor.executeTool(spawn(["a", "b"]))
			expect(firstMessages).to.have.length(2)
			for (const message of firstMessages) {
				expect(message).to.include(
					"<study_brief>\n====\n\nPROJECT CONTEXT\n\nstudy s1, gauge 01031500, plan p7\n</study_brief>",
				)
			}
			const card = JSON.parse(h.asks.find((a) => a.type === "tool")!.text!).subagents
			expect(card.studyBrief).to.equal(true)
			const records = diskRecords()
			expect(records.map((r) => r.studyBriefSha256)).to.have.length(2)
			expect(records.every((r) => /^[0-9a-f]{64}$/.test(r.studyBriefSha256))).to.equal(true)
			expect(new Set(records.map((r) => r.studyBriefSha256)).size).to.equal(1)
		})

		it("with no brief, nothing is added", async () => {
			const firstMessages: string[] = []
			childApis.push(
				scriptedApi([report("done")], {
					onRequest: (_system, history) => firstMessages.push(history[0].content[0].text),
				}),
			)
			await executor.executeTool(spawn(["a"]))
			expect(firstMessages[0]).to.not.include("study_brief")
			expect(JSON.parse(h.asks.find((a) => a.type === "tool")!.text!).subagents.studyBrief).to.equal(undefined)
		})
	})

	describe("per-definition model", () => {
		const withConfig = () => {
			;(h.runnerBase.stateManager as any).getApiConfiguration = () => ({
				actModeApiProvider: "anthropic",
				actModeApiModelId: "claude-parent",
			})
		}
		const handlerCapturing = (seen: any[]) => {
			;(executor as any).coordinator.unregister("spawn_subagents")
			;(executor as any).coordinator.register(
				new SpawnSubagentsToolHandler({
					buildApi: (_config, resolved) => {
						seen.push(resolved)
						return childApis.shift()
					},
				}),
			)
		}

		it("a reviewer with no setting runs on the parent's model and never reads the configuration", async () => {
			const seen: any[] = []
			handlerCapturing(seen)
			childApis.push(scriptedApi([tool("report_review", { summary: "s", verdicts: "supported | a | b" })]))
			await executor.executeTool(spawn(["x"], { profile: "reviewer" }))
			expect(seen[0]).to.include({ ok: true, overridden: false, otherProvider: false })
			expect(seen[0].config).to.equal(undefined)
			const card = JSON.parse(h.asks.find((a) => a.type === "tool")!.text!).subagents
			expect(card.provider).to.equal(undefined)
			expect(card.otherProvider).to.equal(undefined)
		})

		it("a reviewer set to another model on the same provider runs there", async () => {
			withConfig()
			h.settings.agentModels = { reviewer: { modelId: "claude-judge" } }
			const seen: any[] = []
			handlerCapturing(seen)
			childApis.push(
				scriptedApi([tool("report_review", { summary: "s", verdicts: "supported | a | b" })]),
				scriptedApi([tool("report_review", { summary: "s", verdicts: "supported | a | b" })]),
			)
			await executor.executeTool(spawn(["x"], { profile: "reviewer" }))
			expect(seen[0].config.actModeApiModelId).to.equal("claude-judge")
			expect(seen[0].config.actModeApiProvider).to.equal("anthropic")
			expect(seen[0]).to.include({ overridden: true, otherProvider: false })
			expect(JSON.parse(h.asks.find((a) => a.type === "tool")!.text!).subagents.otherProvider).to.equal(undefined)
		})

		it("a reviewer set to another provider says on the card that the prompts leave for it (D7), and records the provider", async () => {
			withConfig()
			h.settings.agentModels = { reviewer: { modelId: "gpt-judge", providerId: "openai-native" } }
			const seen: any[] = []
			handlerCapturing(seen)
			childApis.push(
				scriptedApi([tool("report_review", { summary: "s", verdicts: "supported | a | b" })]),
				scriptedApi([tool("report_review", { summary: "s", verdicts: "supported | a | b" })]),
			)
			await executor.executeTool(spawn(["x"], { profile: "reviewer" }))
			const card = JSON.parse(h.asks.find((a) => a.type === "tool")!.text!).subagents
			expect(card).to.include({ provider: "openai-native", otherProvider: true })
			expect(seen[0].config.actModeApiProvider).to.equal("openai-native")
			expect(diskRecords()[0].providerRequested).to.equal("openai-native")
		})

		it("an explorer ignores the setting: it inherits, so its behaviour is unchanged", async () => {
			withConfig()
			h.settings.agentModels = { explorer: { modelId: "cheap", providerId: "openai-native" } }
			const seen: any[] = []
			handlerCapturing(seen)
			childApis.push(scriptedApi([report("done")]))
			await executor.executeTool(spawn(["x"]))
			expect(seen[0]).to.include({ overridden: false })
			expect(resultText()).to.include('status="completed"')
		})

		it("a setting that cannot be applied refuses the launch, with no card and no fallback to the parent's model", async () => {
			withConfig()
			h.settings.agentModels = { reviewer: { modelId: "x", providerId: "no-such-provider" } }
			await executor.executeTool(spawn(["x"], { profile: "reviewer" }))
			expect(resultText()).to.include("cannot be set on provider 'no-such-provider'")
			expect(h.asks).to.have.length(0)
			h.settings.agentModels = { reviewer: "not an object" }
			taskState.userMessageContent = []
			taskState.didAlreadyUseTool = false
			await executor.executeTool(spawn(["x"], { profile: "reviewer" }))
			expect(resultText()).to.include("is not { modelId, providerId? }")
			expect(h.asks).to.have.length(0)
		})
	})
})
