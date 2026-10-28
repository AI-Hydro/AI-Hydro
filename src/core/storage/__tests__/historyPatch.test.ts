import { expect } from "chai"
import type { HistoryItem } from "@shared/HistoryItem"
import { describe, it } from "mocha"
import { Controller } from "../../controller"
import { toggleTaskFavorite } from "../../controller/task/toggleTaskFavorite"
import { mergeHistoryItem, patchHistory, removeFromHistory } from "../historyPatch"

const base = (over: Partial<HistoryItem> = {}): HistoryItem => ({
	id: "t1",
	ulid: "01HULID",
	ts: 1,
	task: "first",
	tokensIn: 1,
	tokensOut: 1,
	totalCost: 0.1,
	cwdOnTaskInitialization: "/work/a",
	...over,
})

/** The save the task loop sends: loop fields plus the creation fields, never user fields. */
const loopSave = (n: number, cwd = "/elsewhere"): HistoryItem => ({
	id: "t1",
	ulid: "01HULID",
	ts: 100 + n,
	task: "first",
	tokensIn: 10 * n,
	tokensOut: 5 * n,
	totalCost: n,
	size: n,
	cwdOnTaskInitialization: cwd,
})

/** A Controller-shaped stub exercising the real patchTaskHistory / updateTaskHistory methods. */
function fakeController(initial: HistoryItem[]) {
	let history = initial
	const stub: any = {
		stateManager: {
			getGlobalStateKey: () => history,
			setGlobalState: (_k: string, v: HistoryItem[]) => {
				history = v
			},
		},
		postStateToWebview: async () => {},
	}
	stub.patchTaskHistory = (Controller.prototype as any).patchTaskHistory.bind(stub)
	stub.updateTaskHistory = (Controller.prototype as any).updateTaskHistory.bind(stub)
	stub.renameTaskHistory = (Controller.prototype as any).renameTaskHistory.bind(stub)
	return { stub, get: () => history.find((h) => h.id === "t1")! }
}

describe("historyPatch (X0-1: single writer for HistoryItem)", () => {
	it("a favourite toggled during a running task survives the next loop save", async () => {
		const { stub, get } = fakeController([base()])
		await stub.updateTaskHistory(loopSave(1))
		await toggleTaskFavorite(stub, { taskId: "t1", isFavorited: true } as any)
		await stub.updateTaskHistory(loopSave(2))
		await stub.updateTaskHistory(loopSave(3))
		expect(get().isFavorited).to.equal(true)
		expect(get().tokensIn).to.equal(30)
	})

	it("an un-favourite is not reverted either", async () => {
		const { stub, get } = fakeController([base({ isFavorited: true })])
		await toggleTaskFavorite(stub, { taskId: "t1", isFavorited: false } as any)
		await stub.updateTaskHistory(loopSave(1))
		expect(get().isFavorited).to.equal(false)
	})

	it("a user rename persists across the next message and a completion save", () => {
		const { stub, get } = fakeController([base()])
		stub.renameTaskHistory("t1", "Kentucky baseflow")
		for (let n = 1; n <= 20; n++) {
			stub.updateTaskHistory(loopSave(n))
		}
		expect(get().title).to.equal("Kentucky baseflow")
		expect(get().titleSource).to.equal("user")
	})

	it("a system auto-title never replaces a user title, and may replace an auto one", () => {
		let item = mergeHistoryItem(base(), { id: "t1", title: "auto one", titleSource: "auto" }, "system")
		item = mergeHistoryItem(item, { id: "t1", title: "auto two", titleSource: "auto" }, "system")
		expect(item.title).to.equal("auto two")
		item = mergeHistoryItem(item, { id: "t1", title: "Mine", titleSource: "user" }, "user")
		item = mergeHistoryItem(item, { id: "t1", title: "auto three", titleSource: "auto" }, "system")
		expect(item.title).to.equal("Mine")
		expect(item.titleSource).to.equal("user")
	})

	it("cwdOnTaskInitialization is written once and not recomputed on save", () => {
		const { stub, get } = fakeController([])
		stub.updateTaskHistory(loopSave(1, "/work/a"))
		stub.updateTaskHistory(loopSave(2, "/work/b")) // the window changed folder
		stub.updateTaskHistory(loopSave(3, "/work/c"))
		expect(get().cwdOnTaskInitialization).to.equal("/work/a")
	})

	it("creation fields (origin, userQuestion, projectId) are immutable once set", () => {
		let item = mergeHistoryItem(base(), { id: "t1", origin: "map", userQuestion: "why?", projectId: "p1" }, "loop")
		item = mergeHistoryItem(item, { id: "t1", origin: "chat", userQuestion: "other", projectId: "p2" }, "system")
		expect(item).to.include({ origin: "map", userQuestion: "why?", projectId: "p1" })
	})

	it("unknown stored fields (a newer build's) survive 20 saves and a completion", () => {
		const stored = { ...base(), futureField: { a: 1 }, memoryMode: "off", description: "keep" } as HistoryItem
		const { stub, get } = fakeController([stored])
		for (let n = 1; n <= 20; n++) {
			stub.updateTaskHistory(loopSave(n))
		}
		const final = get() as any
		expect(final.futureField).to.deep.equal({ a: 1 })
		expect(final.memoryMode).to.equal("off")
		expect(final.description).to.equal("keep")
	})

	it("the loop cannot write user-owned or binding fields; unknown keys from it are dropped", () => {
		const item = mergeHistoryItem(
			base({ isFavorited: true, activeStudyId: "s1" }),
			{ id: "t1", isFavorited: false, pinned: true, activeStudyId: "s2", mystery: 1 } as any,
			"loop",
		)
		expect(item.isFavorited).to.equal(true)
		expect(item.pinned).to.equal(undefined)
		expect(item.activeStudyId).to.equal("s1")
		expect((item as any).mystery).to.equal(undefined)
	})

	it("only the binding writer changes activeStudyId, and a loop save keeps it", () => {
		const { stub, get } = fakeController([base()])
		stub.patchTaskHistory("t1", { activeStudyId: "01547700" }, "binding")
		stub.updateTaskHistory(loopSave(1))
		expect(get().activeStudyId).to.equal("01547700")
	})

	it("undefined never erases a stored value; null removes it for the owner", () => {
		let item = mergeHistoryItem(base({ description: "d" }), { id: "t1", description: undefined }, "user")
		expect(item.description).to.equal("d")
		item = mergeHistoryItem(item, { id: "t1", description: null as any }, "user")
		expect(item.description).to.equal(undefined)
	})

	it("does not mutate its inputs, and appends an unknown id", () => {
		const history = Object.freeze([Object.freeze(base())]) as HistoryItem[]
		const { history: next } = patchHistory(history, { id: "t2", ts: 5, task: "x", tokensIn: 0, tokensOut: 0, totalCost: 0 }, "loop")
		expect(history).to.have.length(1)
		expect(next.map((h) => h.id)).to.deep.equal(["t1", "t2"])
	})

	it("delete removes only the named item", () => {
		const out = removeFromHistory([base(), base({ id: "t2" })], "t1")
		expect(out.map((h) => h.id)).to.deep.equal(["t2"])
	})
})
