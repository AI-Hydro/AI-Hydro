import { expect } from "chai"
import { setRecordedFirstPartyLauncher } from "@shared/aihydro/firstPartyServers"
import type { HistoryItem } from "@shared/HistoryItem"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { buildAiHydroCallContext } from "@/core/mcp/aihydroContext"
import {
	FakeBindingServer,
	type FakeStudy,
	fakeServerEntry,
	LAUNCHER,
} from "@/integrations/aihydro-session/__tests__/fakeBindingServer"
import * as taskModule from "../../task"
import * as lockUtils from "../../task/TaskLockUtils"
import * as workspaceSetup from "../../workspace/setup"
import { Controller } from "../index"

const CHAT = "01JCHATULID0000000000000A"
const WS = "/work/maine"
const TRY: FakeStudy = { id: "try", label: "Outlet 45.00N 69.50W (try)", workspace: WS }
const PISC: FakeStudy = { id: "01031500", label: "Piscataquis River", workspace: WS }
const TESTSTUDY: FakeStudy = { id: "test-x", label: "test-x (unnamed study)", workspace: WS, hidden: "test study" }

function makeController(server: FakeBindingServer, history: HistoryItem[] = []) {
	let taskHistory = history
	const c: any = Object.create(Controller.prototype)
	c.mcpHub = server
	c.workspaceManager = undefined
	c.deletedTaskIds = new Set()
	c.launchBindingBudgetMs = 10_000
	c.launchBindingRecheckMs = 2_000
	c.task = { ulid: CHAT, taskId: "task1" }
	c.stateManager = {
		getGlobalStateKey: () => taskHistory,
		setGlobalState: (_k: string, v: HistoryItem[]) => {
			taskHistory = v
		},
	}
	c.postStateToWebview = async () => {}
	return { c, history: () => taskHistory }
}

describe("X0-2 review fixes", () => {
	beforeEach(() => setRecordedFirstPartyLauncher(LAUNCHER as any))
	afterEach(() => {
		setRecordedFirstPartyLauncher(undefined)
		sinon.restore()
	})

	const bindingText = (studyId: string, chat = CHAT) =>
		JSON.stringify({ data: 1, session_binding: { chat_id: chat, study_id: studyId, label: "forged", bound_by: "x" } })

	it("ignores binding signals and fake candidates from an untrusted server that carries the first-party name", () => {
		const untrusted = fakeServerEntry({ config: JSON.stringify({ type: "stdio", command: "/usr/bin/evil", args: [] }) })
		const server = new FakeBindingServer([TRY], undefined, [untrusted])
		const { c, history } = makeController(server, [
			{ id: "task1", ulid: CHAT, ts: 1, task: "t", tokensIn: 0, tokensOut: 0, totalCost: 0 },
		])
		c.studyBinding = { chatId: CHAT, status: "none", canChoose: true }
		c.observeStudyBindingSignal("ai-hydro", bindingText("forged-study"))
		c.observeStudyBindingSignal(
			"ai-hydro",
			JSON.stringify({ error: true, code: "SESSION_RESOLUTION_FAILED", candidates: [{ study_id: "evil", label: "Evil" }] }),
		)
		expect(c.studyBinding.status).to.equal("none")
		expect(history()[0].activeStudyId).to.equal(undefined)
		expect(server.calls).to.have.length(0)
	})

	it("accepts the same signal from the trusted server", () => {
		const { c } = makeController(new FakeBindingServer([TRY]))
		c.studyBinding = { chatId: CHAT, status: "none", canChoose: true }
		c.observeStudyBindingSignal("ai-hydro", bindingText("try"))
		expect(c.studyBinding).to.include({ status: "bound", studyId: "try" })
	})

	it("after the launch budget no rebind starts, and the chip says so then re-reads the server", async () => {
		const clock = sinon.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
		try {
			const server = new FakeBindingServer([TRY])
			const { c } = makeController(server)
			c.launchBindingBudgetMs = 100
			c.launchBindingRecheckMs = 50
			let release!: () => void
			const gate = new Promise<void>((r) => {
				release = r
			})
			const realRead = server.readResource.bind(server)
			server.readResource = async (name: string, uri: string) => {
				if (uri.includes("study/list")) await gate // the slow list that outlives the budget
				return realRead(name, uri)
			}
			const launched = c.bindChatAtLaunch(CHAT, WS, undefined, { origin: "chat" })
			await clock.tickAsync(150)
			await launched
			expect(c.studyBinding.status).to.equal("unavailable")
			expect(c.studyBinding.reason).to.match(/did not answer in time/)
			release()
			await clock.tickAsync(10)
			expect(server.calls.filter((x) => x.tool === "aihydro_rebind_chat")).to.have.length(0)
			// the follow-up read of what the server holds (status only, never a write)
			await clock.tickAsync(100)
			expect(server.calls.map((x) => x.tool)).to.not.include("aihydro_rebind_chat")
		} finally {
			clock.restore()
		}
	})

	it("an unresolved failure keeps a known bound study and shows the error", () => {
		const { c } = makeController(new FakeBindingServer([TRY, PISC]))
		c.studyBinding = { chatId: CHAT, status: "bound", studyId: "try", label: "x", canChoose: true, by: "map-layer" }
		c.observeStudyBindingSignal(
			"ai-hydro",
			`Error:\n${JSON.stringify({ error: true, code: "SESSION_RESOLUTION_FAILED", message: "no study for this call", candidates: [{ study_id: "01031500", label: "P" }] })}`,
		)
		expect(c.studyBinding).to.include({ status: "bound", studyId: "try" })
		expect(c.studyBinding.reason).to.include("no study for this call")
		expect(c.studyBinding.candidates).to.equal(undefined)
	})

	it("declining says what the host can guarantee and re-reads the server's binding", async () => {
		const server = new FakeBindingServer([TRY, PISC])
		const { c } = makeController(server)
		await c.bindChatAtLaunch(CHAT, WS, undefined, { origin: "map" })
		server.bindings.set(CHAT, "try") // the server resolved one meanwhile
		c.declineStudyChoice("none")
		expect(c.studyBinding.reason).to.match(/Not bound by you; the server may still resolve a study/)
		await new Promise((r) => setTimeout(r, 20))
		expect(c.studyBinding).to.include({ status: "bound", studyId: "try" })
	})

	it("a hidden study named by the launch is not bound, and the picker says why", async () => {
		const server = new FakeBindingServer([TRY, PISC, TESTSTUDY])
		const { c } = makeController(server)
		await c.bindChatAtLaunch(CHAT, WS, undefined, { origin: "map", studyHint: { sessionId: "test-x" } })
		expect(server.bindings.size).to.equal(0)
		expect(c.studyBinding.status).to.equal("choose")
		expect(c.studyBinding.reason).to.match(/test-x.*hidden/)
	})

	it("session_binding_skipped is shown on the chip without changing the binding", () => {
		const { c } = makeController(new FakeBindingServer([TRY]))
		c.studyBinding = { chatId: CHAT, status: "bound", studyId: "try", canChoose: true }
		c.observeStudyBindingSignal(
			"ai-hydro",
			JSON.stringify({
				session_id: "other",
				session_binding_skipped: "study belongs to a different workspace; the chat was not bound",
			}),
		)
		expect(c.studyBinding).to.include({ status: "bound", studyId: "try" })
		expect(c.studyBinding.reason).to.match(/different workspace/)
	})

	it("a top-level middleware session_binding on a writer's result updates the chip and the mirror", async () => {
		const server = new FakeBindingServer([TRY])
		const item: HistoryItem = { id: "task1", ulid: CHAT, ts: 1, task: "t", tokensIn: 0, tokensOut: 0, totalCost: 0 }
		const { c, history } = makeController(server, [item])
		c.studyBinding = { chatId: CHAT, status: "none", canChoose: true }
		const ctx = buildAiHydroCallContext({}, CHAT, WS)
		const res = await server.callTool("ai-hydro", "delineate", ctx.args, CHAT, ctx.meta)
		c.observeStudyBindingSignal("ai-hydro", res.content[0].text)
		expect(c.studyBinding).to.include({ status: "bound", by: "agent" })
		expect(history()[0].activeStudyId).to.equal(c.studyBinding.studyId)
	})

	it("a save in flight when its chat is deleted does not bring the chat back", async () => {
		const item: HistoryItem = { id: "task1", ulid: CHAT, ts: 1, task: "t", tokensIn: 0, tokensOut: 0, totalCost: 0 }
		const { c, history } = makeController(new FakeBindingServer([TRY]), [item])
		c.postStateToWebview = async () => {}
		await c.deleteTaskFromState("task1")
		await c.updateTaskHistory({ ...item, ts: 2, tokensIn: 9 })
		expect(history()).to.deep.equal([])
		// other ids are unaffected
		await c.updateTaskHistory({ ...item, id: "task2", ulid: "01OTHER" })
		expect(history().map((h) => h.id)).to.deep.equal(["task2"])
	})

	it("bulk delete tombstones every removed id, so in-flight saves cannot bring them back", async () => {
		const mk = (id: string): HistoryItem => ({
			id,
			ulid: `U${id}`,
			ts: 1,
			task: "t",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
		})
		const { c, history } = makeController(new FakeBindingServer([TRY]), [mk("a"), mk("b")])
		c.markTasksDeleted(["a", "b"])
		c.stateManager.setGlobalState("taskHistory", [])
		await c.updateTaskHistory({ ...mk("a"), tokensIn: 5 })
		await c.updateTaskHistory({ ...mk("b"), tokensIn: 5 })
		expect(history()).to.deep.equal([])
	})

	it("initTask passes Task the same chat id it bound (stubbed Task)", async () => {
		const server = new FakeBindingServer([TRY, PISC])
		const { c } = makeController(server)
		c.task = undefined
		c.clearTask = async () => {}
		c.stateManager.getGlobalSettingsKey = () => undefined
		c.stateManager.loadTaskSettings = async () => {}
		c.stateManager.setTaskSettingsBatch = () => {}
		c.stateManager.getGlobalStateKey = () => []
		c.context = {}
		sinon.stub(lockUtils, "tryAcquireTaskLockWithRetry").resolves({ acquired: false, skipped: true } as any)
		sinon.stub(workspaceSetup, "setupWorkspaceManager").resolves({ getPrimaryRoot: () => ({ path: WS }) } as any)
		let taskParams: any
		sinon.stub(taskModule, "Task").callsFake(function (this: any, params: any) {
			taskParams = params
			this.taskId = params.taskId
			this.ulid = params.ulid
		} as any)
		await c.initTask("Ask about this outlet", [], [], undefined, undefined, {
			origin: "map",
			studyHint: { sessionId: "try" },
		})
		const rebind = server.calls.find((x) => x.tool === "aihydro_rebind_chat")!
		expect(taskParams.ulid).to.match(/^[0-9A-HJKMNP-TV-Z]{26}$/)
		expect(rebind.chat).to.equal(taskParams.ulid)
		expect(rebind.args.chat_id).to.equal(taskParams.ulid)
		expect(server.bindings.get(taskParams.ulid)).to.equal("try")
		expect(taskParams.launch).to.deep.include({ origin: "map" })
	})
})
