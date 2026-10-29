import { setRecordedFirstPartyLauncher } from "@shared/aihydro/firstPartyServers"
import type { HistoryItem } from "@shared/HistoryItem"
import { expect } from "chai"
import fs from "fs"
import { afterEach, beforeEach, describe, it } from "mocha"
import os from "os"
import path from "path"
import { AIHYDRO_CONTEXT_META_KEY, buildAiHydroCallContext } from "@/core/mcp/aihydroContext"
import {
	CAPS_282,
	CAPS_283,
	FakeBindingServer,
	type FakeStudy,
	LAUNCHER,
} from "@/integrations/aihydro-session/__tests__/fakeBindingServer"
import { Controller } from "../index"

/** X1-P1 through the real controller methods, with the fake 2.8.3 server standing in for the tools server. */
const CHAT = "01JCHATULID0000000000000A"
let WS = ""

function makeController(server: FakeBindingServer, history: HistoryItem[] = []) {
	let taskHistory = history
	const c: any = Object.create(Controller.prototype)
	c.mcpHub = server
	c.studyBinding = undefined
	c.chatProject = undefined
	c.deletedTaskIds = new Set()
	c.workspaceManager = undefined
	c.task = { ulid: CHAT, taskId: "task1" }
	c.projectBudgetMs = 200
	c.projectRetryMs = 20
	c.stateManager = {
		getGlobalStateKey: () => taskHistory,
		setGlobalState: (_k: string, v: HistoryItem[]) => {
			taskHistory = v
		},
	}
	c.postStateToWebview = async () => {}
	return { c, history: () => taskHistory }
}

describe("X1-P1 projects on chats (controller)", () => {
	const study = (): FakeStudy => ({ id: "try", label: "Outlet (try)", workspace: WS })
	beforeEach(() => {
		setRecordedFirstPartyLauncher(LAUNCHER as any)
		WS = fs.mkdtempSync(path.join(os.tmpdir(), "x1p1-ws-"))
	})
	afterEach(() => {
		setRecordedFirstPartyLauncher(undefined)
		fs.rmSync(WS, { recursive: true, force: true })
	})

	it("a new chat gets the folder's project, stores it once on its history item, and keeps it across later saves", async () => {
		const server = new FakeBindingServer([study()], CAPS_283)
		const { c, history } = makeController(server)
		await c.resolveChatProject(CHAT, WS, undefined)
		const projectId = c.getChatProjectId(CHAT)
		expect(projectId).to.match(/^prj_/)

		const save = (over: Partial<HistoryItem> = {}) =>
			c.updateTaskHistory({ id: "task1", ulid: CHAT, ts: 1, task: "t", tokensIn: 1, tokensOut: 1, totalCost: 0, ...over })
		await save()
		expect(history()[0].projectId).to.equal(projectId)
		// a later save, even one that carries nothing or something else, never moves the chat
		await save({ ts: 2 })
		await save({ ts: 3, projectId: "prj_someone_else" } as any)
		expect(history()).to.have.length(1)
		expect(history()[0].projectId).to.equal(projectId)
	})

	it("every call to the server carries _meta.project_id once the chat has a project", async () => {
		const server = new FakeBindingServer([study()], CAPS_283)
		const { c } = makeController(server)
		await c.resolveChatProject(CHAT, WS, undefined)
		const ctx = buildAiHydroCallContext({ feature: "outlet" }, CHAT, WS, undefined, c.getChatProjectId(CHAT))
		await server.callTool("ai-hydro", "aihydro_chat_status", ctx.args, CHAT, ctx.meta)
		const sent = server.calls.at(-1)!.meta![AIHYDRO_CONTEXT_META_KEY]
		expect(sent.project_id).to.equal(c.getChatProjectId(CHAT))
		expect(sent.chat_id).to.equal(CHAT)
		expect(c.getChatProjectId("a-different-chat")).to.equal(undefined)
	})

	it("a resumed chat keeps its stored project and calls ensure_project no more", async () => {
		const server = new FakeBindingServer([study()], CAPS_283)
		const { c } = makeController(server)
		const item = {
			id: "task1",
			ulid: CHAT,
			ts: 1,
			task: "t",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			projectId: "prj_01JSTORED00000000000000000",
		}
		await c.resolveChatProject(CHAT, WS, item)
		expect(c.getChatProjectId(CHAT)).to.equal("prj_01JSTORED00000000000000000")
		expect(server.calls.filter((x) => x.tool === "ensure_project")).to.have.length(0)
	})

	it("a resumed chat with no project is not guessed into today's folder (the migration places it)", async () => {
		const server = new FakeBindingServer([study()], CAPS_283)
		const { c } = makeController(server)
		await c.resolveChatProject(CHAT, WS, {
			id: "task1",
			ulid: CHAT,
			ts: 1,
			task: "t",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
		})
		expect(c.getChatProjectId(CHAT)).to.equal(undefined)
		expect(server.calls.filter((x) => x.tool === "ensure_project")).to.have.length(0)
	})

	it("an older server: no projectId, no crash, the chat saves normally, and the chip carries the message", async () => {
		const server = new FakeBindingServer([study()], CAPS_282)
		const { c, history } = makeController(server)
		await c.resolveChatProject(CHAT, WS, undefined)
		expect(c.getChatProjectId(CHAT)).to.equal(undefined)
		expect(c.chatProject.note).to.include("2.8.3")
		await c.updateTaskHistory({ id: "task1", ulid: CHAT, ts: 1, task: "t", tokensIn: 0, tokensOut: 0, totalCost: 0 })
		expect(history()[0]).to.not.have.property("projectId")
	})

	it("the server is not connected yet: no project at first, then the project arrives and is stored when the chat's item exists", async () => {
		const server = new FakeBindingServer([study()], CAPS_283, [])
		const { c, history } = makeController(server)
		await c.resolveChatProject(CHAT, WS, undefined)
		expect(c.getChatProjectId(CHAT)).to.equal(undefined)
		await c.updateTaskHistory({ id: "task1", ulid: CHAT, ts: 1, task: "t", tokensIn: 0, tokensOut: 0, totalCost: 0 })
		expect(history()[0].projectId).to.equal(undefined)

		server.servers = [{ ...(await import("@/integrations/aihydro-session/__tests__/fakeBindingServer")).fakeServerEntry() }]
		await new Promise((r) => setTimeout(r, 120))
		expect(c.getChatProjectId(CHAT)).to.match(/^prj_/)
		expect(history()[0].projectId).to.equal(c.getChatProjectId(CHAT))
	})

	it("the picker lists the project's studies", async () => {
		const server = new FakeBindingServer([study(), { id: "far", label: "Far away", workspace: "/elsewhere" }], CAPS_283)
		const { c } = makeController(server)
		await c.resolveChatProject(CHAT, WS, undefined)
		c.studyBinding = { chatId: CHAT, status: "bound", studyId: "try", canChoose: true }
		await c.openStudyPicker()
		expect(c.studyBinding.status).to.equal("choose")
		expect(c.studyBinding.candidates.map((x: any) => x.studyId)).to.deep.equal(["try"])
	})

	describe("M1 migration run by the controller", () => {
		const base = (id: string, over: Partial<HistoryItem>): HistoryItem => ({
			id,
			ts: 1,
			task: "t",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			...over,
		})

		it("assigns by folder, leaves the rest in Unsorted, and a second run changes nothing and calls nothing", async () => {
			const server = new FakeBindingServer([study()], CAPS_283)
			const { c, history } = makeController(server, [
				base("1", { cwdOnTaskInitialization: WS, isFavorited: true }),
				base("2", { cwdOnTaskInitialization: WS }),
				base("3", { cwdOnTaskInitialization: path.join(WS, "moved-away") }),
				base("4", {}),
			])
			const first = await c.migrateHistoryToProjects()
			expect(first).to.deep.equal({ assigned: 2, unsorted: 2, failedFolders: 0 })
			expect(history()[0].projectId).to.match(/^prj_/)
			expect(history()[0].projectId).to.equal(history()[1].projectId)
			expect(history()[0].isFavorited).to.equal(true)
			expect(history()[2].projectId).to.equal(undefined)

			const snapshot = JSON.stringify(history())
			const callsBefore = server.calls.length
			const second = await c.migrateHistoryToProjects()
			expect(second.assigned).to.equal(0)
			expect(JSON.stringify(history())).to.equal(snapshot)
			expect(server.calls.length).to.equal(callsBefore)
		})

		it("with an older server nothing is assigned or lost, and the next activation retries", async () => {
			const server = new FakeBindingServer([study()], CAPS_282)
			const { c, history } = makeController(server, [base("1", { cwdOnTaskInitialization: WS })])
			const r = await c.migrateHistoryToProjects()
			expect(r).to.deep.equal({ assigned: 0, unsorted: 0, failedFolders: 1 })
			expect(history()[0].projectId).to.equal(undefined)

			server.caps = CAPS_283 // the server is updated
			expect((await c.migrateHistoryToProjects()).assigned).to.equal(1)
		})
	})
})
