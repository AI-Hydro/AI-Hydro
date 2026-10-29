import { Controller } from "@core/controller"
import { confirmAbortRunningTask, STOP_AND_CONTINUE_LABEL } from "@core/controller/abortGuard"
import { explainWithAiHydro } from "@core/controller/commands/explainWithAiHydro"
import { fixWithAiHydro } from "@core/controller/commands/fixWithAiHydro"
import { improveWithAiHydro } from "@core/controller/commands/improveWithAiHydro"
import { clearTask } from "@core/controller/task/clearTask"
import { deleteAllTaskHistory } from "@core/controller/task/deleteAllTaskHistory"
import { executeQuickWin } from "@core/controller/task/executeQuickWin"
import { newTask } from "@core/controller/task/newTask"
import { showTaskWithId } from "@core/controller/task/showTaskWithId"
import { plusButtonClicked } from "@core/controller/ui/plusButton"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"

/**
 * Nav-1: every user-initiated path that replaces the chat asks first while a chat is running, leaves it untouched on
 * Cancel, and stops it on "Stop and continue". Idle chats never ask. Only HostProvider.window is stubbed; the guard
 * itself is the real one.
 */
const task = (last?: { ask?: string; say?: string }, abort = false) => ({
	taskId: "t1",
	taskState: { abort },
	messageStateHandler: { getAiHydroMessages: () => (last ? [{ say: "task" }, last] : []) },
})
const GUARD_MESSAGE = "A chat is still running. Stop it and start a new one?"
const RUNNING = [
	["streaming", { say: "api_req_started" }],
	["running a tool", { say: "command_output" }],
	["waiting on an approval ask", { ask: "command" }],
] as const

function fakeController(t: unknown) {
	const log: string[] = []
	const c: any = {
		task: t,
		stateManager: { getGlobalStateKey: () => [{ id: "h1", task: "old" }] },
		clearTask: async () => void log.push("clearTask"),
		postStateToWebview: async () => {},
		initTask: async () => {
			log.push("initTask")
			return "new-id"
		},
		getTaskWithId: async () => ({ historyItem: { id: "h1", task: "old" } }),
	}
	return { c, log }
}

type Path = { name: string; run: (c: any) => Promise<unknown>; touched: string[] }
const PATHS: Path[] = [
	{ name: "view-title New Task (plusButton)", run: (c) => plusButtonClicked(c), touched: ["clearTask"] },
	{ name: "header New task / Navbar Chat tab (clearTask rpc)", run: (c) => clearTask(c, {} as any), touched: ["clearTask"] },
	{
		name: "History: showTaskWithId",
		run: (c) => showTaskWithId(c, { value: "h1" } as any),
		touched: ["initTask"],
	},
	{
		name: "newTask rpc (starter card)",
		run: (c) => newTask(c, { text: "go", images: [], files: [] } as any),
		touched: ["initTask"],
	},
	{ name: "executeQuickWin", run: (c) => executeQuickWin(c, { command: "x", title: "t" } as any), touched: ["initTask"] },
	{ name: "deleteAllTaskHistory", run: (c) => deleteAllTaskHistory(c), touched: ["clearTask"] },
	{
		name: "fixWithAiHydro",
		run: (c) => fixWithAiHydro(c, { filePath: "", selectedText: "x", diagnostics: [] } as any),
		touched: ["initTask"],
	},
	{
		name: "explainWithAiHydro",
		run: (c) => explainWithAiHydro(c, { filePath: "", selectedText: "x", language: "ts" } as any),
		touched: ["initTask"],
	},
	{
		name: "improveWithAiHydro",
		run: (c) => improveWithAiHydro(c, { filePath: "", selectedText: "x", language: "ts" } as any),
		touched: ["initTask"],
	},
	{
		name: "handleTaskCreation (aihydro:// /task URI)",
		run: (c) => Controller.prototype.handleTaskCreation.call(c, "go"),
		touched: ["initTask"],
	},
]

describe("Nav-1 abort guard", () => {
	let asked: string[]
	let answer: string | undefined
	beforeEach(() => {
		asked = []
		answer = undefined
		sinon.stub(HostProvider, "workspace").get(() => ({ getWorkspacePaths: async () => ({ paths: [] }) }) as any)
		sinon.stub(HostProvider, "window").get(
			() =>
				({
					showMessage: async (req: { message: string; options: { items: string[] } }) => {
						if (req.message !== GUARD_MESSAGE) {
							return { selectedOption: undefined } // some other modal (e.g. delete-all's own): decline
						}
						asked.push(req.message)
						expect(req.options.items).to.deep.equal([STOP_AND_CONTINUE_LABEL])
						return { selectedOption: answer }
					},
				}) as any,
		)
	})
	afterEach(() => sinon.restore())

	for (const p of PATHS) {
		describe(p.name, () => {
			for (const [label, last] of RUNNING) {
				it(`keeps a chat that is ${label} when the user cancels`, async () => {
					const { c, log } = fakeController(task(last))
					answer = undefined // Cancel
					await p.run(c)
					expect(asked).to.have.length(1)
					expect(asked[0]).to.equal(GUARD_MESSAGE)
					expect(log).to.not.include.members(p.touched)
					expect(log).to.not.include("clearTask")
					expect(log).to.not.include("initTask")
				})
			}
			it("stops the chat after 'Stop and continue'", async () => {
				const { c, log } = fakeController(task({ say: "api_req_started" }))
				answer = STOP_AND_CONTINUE_LABEL
				await p.run(c)
				expect(asked).to.have.length(1)
				expect(log).to.include.members(p.touched)
			})
			it("does not ask when the chat is idle, finished, resumable or absent", async () => {
				for (const t of [
					undefined,
					task({ say: "completion_result" }),
					task({ ask: "resume_task" }),
					task({ say: "x" }, true),
				]) {
					const { c, log } = fakeController(t)
					await p.run(c)
					expect(log).to.include.members(p.touched)
				}
				expect(asked).to.deep.equal([])
			})
		})
	}

	describe("confirmAbortRunningTask", () => {
		it("a host that cannot show the modal keeps the running chat", async () => {
			sinon.restore()
			sinon.stub(HostProvider, "window").get(() => {
				throw new Error("no host")
			})
			expect(await confirmAbortRunningTask({ task: task({ ask: "tool" }) as any }, "t")).to.equal(false)
			expect(await confirmAbortRunningTask({ task: undefined }, "t")).to.equal(true)
		})
		it("the modal failing warns and posts a non-modal notice instead of failing silently", async () => {
			sinon.restore()
			const warn = sinon.stub(console, "warn")
			const notices: string[] = []
			let calls = 0
			sinon.stub(HostProvider, "window").get(
				() =>
					({
						showMessage: async (req: { message: string; options?: unknown }) => {
							calls++
							if (req.options) {
								throw new Error("no modal")
							}
							notices.push(req.message)
							return {}
						},
					}) as any,
			)
			expect(await confirmAbortRunningTask({ task: task({ ask: "tool" }) as any }, "t")).to.equal(false)
			expect(calls).to.equal(2)
			expect(warn.calledOnce).to.equal(true)
			expect(notices).to.deep.equal(["Kept the running chat; stop it first to start a new one."])
		})
		it("a pending new_task ask is being answered by the user: newTask does not ask, other paths still do", async () => {
			const { c, log } = fakeController(task({ ask: "new_task" }))
			await newTask(c, { text: "ctx", images: [], files: [] } as any)
			expect(asked).to.deep.equal([])
			expect(log).to.include("initTask")
			const other = fakeController(task({ ask: "new_task" }))
			await clearTask(other.c, {} as any)
			expect(asked).to.have.length(1)
			expect(other.log).to.not.include("clearTask")
		})
		it("a pending ask counts as running and the injected confirm decides", async () => {
			const t = task({ ask: "followup" }) as any
			expect(await confirmAbortRunningTask({ task: t }, "t", { confirm: async () => true })).to.equal(true)
			expect(await confirmAbortRunningTask({ task: t }, "t", { confirm: async () => false })).to.equal(false)
			expect(asked).to.deep.equal([])
		})
	})
})
