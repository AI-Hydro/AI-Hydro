import type { HistoryItem } from "@shared/HistoryItem"
import { expect } from "chai"
import { describe, it } from "mocha"
import { Controller } from "../index"

/** X1-P2 through the real controller write path (updateTaskHistory, patchTaskHistory, renameChat). In-memory state only. */
function makeController(history: HistoryItem[] = [], settings: { autoTitle?: boolean; titleModel?: string } = {}) {
	let taskHistory = history
	const calls: string[] = []
	const c: any = Object.create(Controller.prototype)
	c.deletedTaskIds = new Set()
	c.chatProject = undefined
	c.studyBinding = undefined
	c.task = { taskId: "task1", ulid: "01JCHAT", messageStateHandler: { getAiHydroMessages: () => [] } }
	c.stateManager = {
		getGlobalStateKey: () => taskHistory,
		setGlobalState: (_k: string, v: HistoryItem[]) => {
			taskHistory = v
		},
		getGlobalSettingsKey: (k: string) =>
			k === "autoTitle" ? (settings.autoTitle ?? true) : k === "titleModel" ? (settings.titleModel ?? "") : "act",
		getApiConfiguration: () => ({}),
	}
	c.postStateToWebview = async () => {}
	// The model: replaced on the title service's own deps (the controller's real call needs a provider).
	c.callTitleModel = async (_s: string, user: string) => {
		calls.push(user)
		return '{"title":"Baseflow in two synthetic basins","description":"Two synthetic basins."}'
	}
	return { c, history: () => taskHistory, calls }
}

const save = (c: any, over: Partial<HistoryItem> = {}) =>
	c.updateTaskHistory({
		id: "task1",
		ulid: "01JCHAT",
		ts: 1,
		task: "Compare baseflow in two synthetic basins",
		tokensIn: 1,
		tokensOut: 1,
		totalCost: 0,
		...over,
	})

describe("X1-P2 titles through the controller", () => {
	it("(a) a renamed title survives 20 message saves, an automatic title request and a completion", async () => {
		const { c, history, calls } = makeController()
		await save(c)
		expect(c.renameChat("task1", "My own name")).to.deep.include({ ok: true })
		for (let i = 0; i < 20; i++) {
			await save(c, { ts: 2 + i, tokensIn: 10 + i })
			c.requestChatTitle("first_turn")
		}
		c.requestChatTitle("completion")
		await new Promise((r) => setTimeout(r, 20))
		expect(history()[0]).to.deep.include({ title: "My own name", titleSource: "user", tokensIn: 29 })
		expect(calls).to.have.length(0)
	})

	it("an automatic title lands once, then survives later saves; a rename after it wins", async () => {
		const { c, history, calls } = makeController()
		await save(c)
		c.requestChatTitle("first_turn")
		await new Promise((r) => setTimeout(r, 20))
		expect(history()[0]).to.deep.include({ title: "Baseflow in two synthetic basins", titleSource: "auto" })
		for (let i = 0; i < 20; i++) {
			await save(c, { ts: 2 + i })
		}
		expect(history()[0].title).to.equal("Baseflow in two synthetic basins")
		c.renameChat("task1", "Renamed")
		c.requestChatTitle("completion")
		await new Promise((r) => setTimeout(r, 20))
		expect(history()[0]).to.deep.include({ title: "Renamed", titleSource: "user" })
		expect(calls).to.have.length(1)
	})

	it("(d) with autoTitle off no model call is made for any trigger or for a reset", async () => {
		const { c, history, calls } = makeController([], { autoTitle: false })
		await save(c)
		c.requestChatTitle("first_turn")
		c.requestChatTitle("completion")
		c.renameChat("task1", "Mine")
		c.renameChat("task1", "")
		await new Promise((r) => setTimeout(r, 20))
		expect(calls).to.have.length(0)
		expect(history()[0]).to.deep.include({ titleSource: "fallback", title: "Compare baseflow in two synthetic basins" })
	})

	it("a reset asks for a new automatic title (the user's request), then the title is automatic", async () => {
		const { c, history, calls } = makeController()
		await save(c)
		c.renameChat("task1", "Mine")
		c.renameChat("task1", "")
		await new Promise((r) => setTimeout(r, 20))
		expect(calls).to.have.length(1)
		expect(history()[0]).to.deep.include({ titleSource: "auto" })
	})

	it("a loop save cannot carry a title or description into the item", async () => {
		const { c, history } = makeController()
		await save(c)
		c.renameChat("task1", "Mine", "My note")
		await save(c, { title: "Loop title", titleSource: "auto", description: "Loop note" } as any)
		expect(history()[0]).to.deep.include({ title: "Mine", titleSource: "user", description: "My note" })
	})
})
