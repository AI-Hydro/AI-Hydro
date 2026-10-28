import { expect } from "chai"
import { setRecordedFirstPartyLauncher } from "@shared/aihydro/firstPartyServers"
import type { HistoryItem } from "@shared/HistoryItem"
import { afterEach, beforeEach, describe, it } from "mocha"
import { buildAiHydroCallContext } from "@/core/mcp/aihydroContext"
import { FakeBindingServer, type FakeStudy, LAUNCHER } from "@/integrations/aihydro-session/__tests__/fakeBindingServer"
import { Controller } from "../index"

/**
 * Acceptance (X0-2, the owner's 2026-10-28 failure replayed): a chat launched from the map on study `try` makes a
 * read-only `measure_feature` call. Before: SESSION_RESOLUTION_FAILED with no way out. Now the host binds the chat
 * BEFORE the call (the read-only call never binds), or, when the choice is ambiguous, shows a picker and binds only
 * what the user picks. The fake server models the 2.8.2 contract; the controller methods are the real ones.
 */
const CHAT = "01JCHATULID0000000000000A"
const WS = "/work/maine"
const TRY: FakeStudy = { id: "try", label: "Outlet 45.00N 69.50W (try)", workspace: WS }
const PISC: FakeStudy = { id: "01031500", label: "Piscataquis River near Dover-Foxcroft, ME (USGS 01031500)", workspace: WS }

function makeController(server: FakeBindingServer, history: HistoryItem[] = []) {
	const posted: unknown[] = []
	let taskHistory = history
	const c: any = Object.create(Controller.prototype)
	c.mcpHub = server
	c.studyBinding = undefined
	c.deletedTaskIds = new Set()
	c.workspaceManager = undefined
	c.task = { ulid: CHAT, taskId: "task1" }
	c.stateManager = {
		getGlobalStateKey: () => taskHistory,
		setGlobalState: (_k: string, v: HistoryItem[]) => {
			taskHistory = v
		},
	}
	c.postStateToWebview = async () => {
		posted.push(c.studyBinding)
	}
	const measure = async () => {
		const ctx = buildAiHydroCallContext({ feature: "outlet" }, CHAT, WS)
		const res = await server.callTool("ai-hydro", "measure_feature", ctx.args, CHAT, ctx.meta)
		const text = res.content.map((x: any) => x.text).join("\n")
		// what UseMcpToolHandler does with every result
		c.observeStudyBindingSignal("ai-hydro", (res.isError ? "Error:\n" : "") + text)
		return { text, isError: res.isError }
	}
	return { c, measure, posted, history: () => taskHistory }
}

describe("X0-2 acceptance: map-launched chat on `try`, read-only measure_feature", () => {
	beforeEach(() => setRecordedFirstPartyLauncher(LAUNCHER as any))
	afterEach(() => setRecordedFirstPartyLauncher(undefined))

	it("the host binds the layer's study at launch, so the read-only call resolves (no SESSION_RESOLUTION_FAILED)", async () => {
		const server = new FakeBindingServer([TRY, PISC])
		const { c, measure } = makeController(server)
		await c.bindChatAtLaunch(CHAT, WS, undefined, { origin: "map", studyHint: { sessionId: "try" } })
		expect(c.studyBinding).to.include({ chatId: CHAT, status: "bound", studyId: "try", by: "map-layer" })

		const result = await measure()
		expect(result.isError).to.equal(false)
		expect(result.text).to.not.include("SESSION_RESOLUTION_FAILED")
		expect(JSON.parse(result.text).session_id).to.equal("try")
		// the order is the point: the binding call came first
		expect(server.calls.map((x) => x.tool)).to.deep.equal(["aihydro_rebind_chat", "measure_feature"])
	})

	it("ambiguous launch: a picker with labelled candidates, then the user's choice binds and the call resolves", async () => {
		const server = new FakeBindingServer([TRY, PISC])
		const { c, measure } = makeController(server)
		await c.bindChatAtLaunch(CHAT, WS, undefined, { origin: "map" }) // no layer hint, two studies in the folder
		expect(c.studyBinding.status).to.equal("choose")
		expect(c.studyBinding.candidates.map((x: any) => x.label)).to.deep.equal([TRY.label, PISC.label])
		expect(server.bindings.size).to.equal(0) // nothing was guessed

		// the agent's read-only call before the user has picked: the failure surfaces the same picker, not a dead end
		const failed = await measure()
		expect(failed.text).to.include("SESSION_RESOLUTION_FAILED")
		expect(c.studyBinding.status).to.equal("choose")
		expect(c.studyBinding.candidates).to.have.length(2)

		await c.chooseStudy("try")
		expect(c.studyBinding).to.include({ status: "bound", studyId: "try", by: "user" })
		const ok = await measure()
		expect(ok.isError).to.equal(false)
		expect(JSON.parse(ok.text).session_id).to.equal("try")
	})

	it("a study that was not offered cannot be chosen", async () => {
		const server = new FakeBindingServer([TRY, PISC, { id: "elsewhere", label: "Elsewhere", workspace: "/x" }])
		const { c } = makeController(server)
		await c.bindChatAtLaunch(CHAT, WS, undefined, { origin: "map" })
		await c.chooseStudy("elsewhere")
		expect(c.studyBinding.status).to.equal("choose")
		expect(server.bindings.size).to.equal(0)
	})

	it("an unresolved failure with candidates opens the picker even on an unbound, unlaunched chat", async () => {
		const server = new FakeBindingServer([TRY, PISC])
		const { c, measure } = makeController(server)
		c.studyBinding = undefined
		await measure()
		expect(c.studyBinding).to.include({ status: "choose" })
		expect(c.studyBinding.candidates.map((x: any) => x.studyId)).to.deep.equal(["try", "01031500"])
	})

	it("declining the picker binds nothing; 'No study' and 'New study' say what happens next", async () => {
		const server = new FakeBindingServer([TRY, PISC])
		const { c } = makeController(server)
		await c.bindChatAtLaunch(CHAT, WS, undefined, { origin: "map" })
		c.declineStudyChoice("new")
		expect(c.studyBinding).to.include({ status: "none" })
		expect(c.studyBinding.reason).to.match(/new study/i)
		expect(server.bindings.size).to.equal(0)
	})

	it("a binding the agent makes is shown (session_binding), mirrored into history by the binding writer only", async () => {
		const server = new FakeBindingServer([TRY, PISC])
		const item: HistoryItem = { id: "task1", ulid: CHAT, ts: 1, task: "t", tokensIn: 0, tokensOut: 0, totalCost: 0 }
		const { c, history } = makeController(server, [item])
		c.studyBinding = { chatId: CHAT, status: "none", canChoose: true }
		const ctx = buildAiHydroCallContext({ study_id: "try" }, CHAT, WS)
		const res = await server.callTool("ai-hydro", "aihydro_rebind_chat", ctx.args, CHAT, ctx.meta)
		c.observeStudyBindingSignal("ai-hydro", res.content[0].text)
		expect(c.studyBinding).to.include({ status: "bound", studyId: "try", by: "agent" })
		expect(history()[0].activeStudyId).to.equal("try")
		// a later loop save keeps it
		await c.updateTaskHistory({ ...item, ts: 2, tokensIn: 5 })
		expect(history()[0]).to.include({ activeStudyId: "try", tokensIn: 5 })
	})

	it("a binding made before the first save is mirrored when the item appears", async () => {
		const server = new FakeBindingServer([TRY])
		const { c, history } = makeController(server, [])
		await c.bindChatAtLaunch(CHAT, WS, undefined, { origin: "chat" }) // one study: bound before any history item exists
		expect(history()).to.have.length(0)
		await c.updateTaskHistory({ id: "task1", ulid: CHAT, ts: 1, task: "t", tokensIn: 0, tokensOut: 0, totalCost: 0 })
		expect(history()[0].activeStudyId).to.equal("try")
	})

	it("the host never puts a study id in the call context (_meta) it injects", async () => {
		const server = new FakeBindingServer([TRY, PISC])
		const { c, measure } = makeController(server)
		await c.bindChatAtLaunch(CHAT, WS, undefined, { origin: "map", studyHint: { sessionId: "try" } })
		await measure()
		for (const call of server.calls) {
			expect(JSON.stringify(call.meta ?? {})).to.not.include("study_id")
		}
	})

	it("an older server: the failure has no candidates, the chip says so and nothing is bound for the user", async () => {
		const server = new FakeBindingServer([TRY, PISC], null)
		const { c, measure } = makeController(server)
		await c.bindChatAtLaunch(CHAT, WS, undefined, { origin: "map" })
		expect(c.studyBinding).to.include({ status: "unavailable", canChoose: false })
		const failed = await measure()
		expect(failed.text).to.include("SESSION_RESOLUTION_FAILED")
		expect(server.bindings.size).to.equal(0)
		expect(c.studyBinding.status).to.not.equal("bound")
	})
})
