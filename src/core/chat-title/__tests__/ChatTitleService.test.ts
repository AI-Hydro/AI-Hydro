import type { HistoryItem } from "@shared/HistoryItem"
import { expect } from "chai"
import fs from "fs"
import { afterEach, beforeEach, describe, it } from "mocha"
import os from "os"
import path from "path"
import { patchHistory } from "../../storage/historyPatch"
import { backupHistoryOnce } from "../../storage/projectMigration"
import { type ChatTitleDeps, ChatTitleService } from "../ChatTitleService"

/** An in-memory history behind the real merge rules (historyPatch.ts); nothing here touches the real globalStorage. */
function harness(items: HistoryItem[], opts: { autoTitle?: boolean; reply?: string; delay?: Promise<void> } = {}) {
	let history = items
	let autoTitle = opts.autoTitle ?? true
	const calls: Array<{ user: string }> = []
	let changes = 0
	const deps: ChatTitleDeps = {
		getHistory: () => history,
		patch: (id, patch, writer) => {
			history = patchHistory(history, { ...(patch as Partial<HistoryItem>), id }, writer).history
		},
		settings: () => ({ autoTitle, titleModel: "" }),
		call: async (_s, user, signal) => {
			calls.push({ user })
			if (opts.delay) {
				await Promise.race([
					opts.delay,
					new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")))),
				])
			}
			return opts.reply ?? '{"title":"Baseflow in two synthetic basins","description":"Compares two synthetic basins."}'
		},
		loadExchange: async () => ({ firstAssistantText: "Here is the comparison", toolNames: ["get_streamflow"] }),
		studyLabelFor: () => undefined,
		changed: () => {
			changes++
		},
	}
	return {
		service: new ChatTitleService(deps),
		deps,
		calls,
		history: () => history,
		get: (id: string) => history.find((h) => h.id === id)!,
		setAuto: (v: boolean) => {
			autoTitle = v
		},
		changes: () => changes,
	}
}

const item = (id: string, over: Partial<HistoryItem> = {}): HistoryItem => ({
	id,
	ts: 1,
	task: "Compare baseflow in two synthetic basins",
	tokensIn: 1,
	tokensOut: 1,
	totalCost: 0,
	...over,
})

describe("X1-P2 ChatTitleService: automatic titles", () => {
	it("titles a chat after its first turn, then once more at completion, then never again", async () => {
		const h = harness([item("a")])
		await h.service.request("a", "first_turn")
		expect(h.get("a")).to.deep.include({ title: "Baseflow in two synthetic basins", titleSource: "auto", titleRuns: 1 })
		await h.service.request("a", "first_turn")
		expect(h.calls).to.have.length(1)
		await h.service.request("a", "completion")
		expect(h.calls).to.have.length(2)
		await h.service.request("a", "completion")
		await h.service.request("a", "first_turn")
		expect(h.calls).to.have.length(2)
		expect(h.get("a").titleRuns).to.equal(2)
	})

	it("(a) a user rename is never overwritten, including by a title that finishes after it", async () => {
		let release!: () => void
		const delay = new Promise<void>((r) => (release = r))
		const h = harness([item("a")], { delay })
		const pending = h.service.request("a", "first_turn")
		await new Promise((r) => setImmediate(r))
		const renamed = h.service.rename("a", "My own name")
		expect(renamed.ok).to.equal(true)
		release()
		await pending
		expect(h.get("a")).to.deep.include({ title: "My own name", titleSource: "user" })
		// And a later trigger, with a reply that would pass, still leaves it.
		await h.service.request("a", "completion")
		expect(h.get("a").title).to.equal("My own name")
	})

	it("a user title also locks the description; the generator never writes either", async () => {
		const h = harness([item("a", { title: "Mine", titleSource: "user", description: "My note" })])
		await h.service.request("a", "completion")
		expect(h.calls).to.have.length(0)
		expect(h.get("a")).to.deep.include({ title: "Mine", description: "My note" })
	})

	it("(d) with autoTitle off, no model call is made by a trigger; the chat gets the deterministic title", async () => {
		const h = harness([item("a")], { autoTitle: false })
		await h.service.request("a", "first_turn")
		await h.service.request("a", "completion")
		expect(h.calls).to.have.length(0)
		expect(h.get("a")).to.deep.include({ title: "Compare baseflow in two synthetic basins", titleSource: "fallback" })
		expect(h.get("a").titleRuns).to.equal(undefined)
		// later replies of the same chat change nothing and repost nothing
		const changes = h.changes()
		await h.service.request("a", "first_turn")
		await h.service.request("a", "completion")
		expect(h.changes()).to.equal(changes)
	})

	it("an unusable reply keeps the fallback and still counts the call (two at most)", async () => {
		const h = harness([item("a")], { reply: '{"title":"Basin 01031500"}' })
		await h.service.request("a", "first_turn")
		expect(h.get("a")).to.deep.include({ titleSource: "fallback", titleRuns: 1 })
		await h.service.request("a", "completion")
		await h.service.request("a", "completion")
		expect(h.calls).to.have.length(2)
	})

	it("a fallback never replaces a title a model already wrote", async () => {
		const h = harness([item("a", { title: "Model title", titleSource: "auto", titleRuns: 1 })], { reply: "not json" })
		await h.service.request("a", "completion")
		expect(h.get("a")).to.deep.include({ title: "Model title", titleSource: "auto", titleRuns: 2 })
	})

	it("a chat deleted while the model works is not brought back", async () => {
		let release!: () => void
		const delay = new Promise<void>((r) => (release = r))
		const h = harness([item("a")], { delay })
		const pending = h.service.request("a", "first_turn")
		await new Promise((r) => setImmediate(r))
		// the chat is deleted: it leaves the history while the model is still working
		;(h.deps as { getHistory: () => readonly HistoryItem[] }).getHistory = () => []
		release()
		await pending
		expect(h.history().filter((x) => x.title)).to.have.length(0)
	})

	it("cancelFor stops a title in flight and writes nothing", async () => {
		const never = new Promise<void>(() => {})
		const h = harness([item("a")], { delay: never })
		const pending = h.service.request("a", "first_turn")
		await new Promise((r) => setImmediate(r))
		h.service.cancelFor("a")
		await pending
		expect(h.get("a").title).to.equal(undefined)
	})
})

describe("X1-P2 ChatTitleService: rename and reset", () => {
	it("rename stores a checked, locked title; an invalid or unknown one changes nothing", () => {
		const h = harness([item("a", { title: "Auto", titleSource: "auto" })])
		expect(h.service.rename("a", "  Kentucky   low flows  ")).to.deep.include({ ok: true })
		expect(h.get("a")).to.deep.include({ title: "Kentucky low flows", titleSource: "user" })
		expect(h.service.rename("a", "x".repeat(61))).to.deep.equal({ ok: false, reason: "invalid", detail: "too_long" })
		expect(h.service.rename("a", "01031500")).to.deep.equal({ ok: false, reason: "invalid", detail: "id" })
		expect(h.service.rename("a", "a\nb")).to.deep.equal({ ok: false, reason: "invalid", detail: "newline" })
		expect(h.service.rename("nope", "x")).to.deep.equal({ ok: false, reason: "not_found" })
		expect(h.get("a").title).to.equal("Kentucky low flows")
	})

	it("an empty title resets to automatic: the lock is cleared and the deterministic title stored", () => {
		const h = harness([item("a", { title: "Mine", titleSource: "user", description: "d", titleRuns: 2 })])
		const r = h.service.rename("a", "")
		expect(r).to.deep.include({ ok: true, reset: true })
		expect(h.get("a")).to.deep.include({ title: "Compare baseflow in two synthetic basins", titleSource: "fallback" })
		expect(h.get("a").description).to.equal(undefined)
		expect(h.get("a").titleRuns).to.equal(undefined)
	})

	it("a description alone locks too", () => {
		const h = harness([item("a", { title: "Auto", titleSource: "auto" })])
		expect(h.service.rename("a", "", "A note").ok).to.equal(true)
		expect(h.get("a")).to.deep.include({ title: "Auto", titleSource: "user", description: "A note" })
	})
})

describe("X1-P2 ChatTitleService: M2 fallback titles", () => {
	let dir = ""
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "x1p2-"))
	})
	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true })
	})

	it("titles every chat with none, leaves the rest alone, takes one backup, and is idempotent", async () => {
		const file = path.join(dir, "taskHistory.json")
		const items = [
			item("a"),
			item("b", { task: "The user clicked the AI-Hydro map and wants hydrology help for this location." }),
			item("c", { origin: "map", userQuestion: "Why is the low flow flat?", task: "wrapped prompt text" }),
			item("d", { title: "Mine", titleSource: "user" }),
			item("e", { title: "From a model", titleSource: "auto" }),
		]
		fs.writeFileSync(file, JSON.stringify(items))
		const h = harness(items)
		h.deps.backup = async () => {
			await backupHistoryOnce(file, new Date(), "bak-pre-titles-")
		}
		expect(await h.service.ensureFallbackTitles()).to.equal(3)
		expect(h.get("a")).to.deep.include({ title: "Compare baseflow in two synthetic basins", titleSource: "fallback" })
		expect(h.get("b")).to.deep.include({ title: "Map location question", titleSource: "fallback" })
		expect(h.get("c")).to.deep.include({ title: "Why is the low flow flat", titleSource: "fallback" })
		expect(h.get("d")).to.deep.include({ title: "Mine", titleSource: "user" })
		expect(h.get("e")).to.deep.include({ title: "From a model", titleSource: "auto" })
		expect(h.calls).to.have.length(0)
		const backups = fs.readdirSync(dir).filter((f) => f.includes("bak-pre-titles-"))
		expect(backups).to.have.length(1)
		expect(JSON.parse(fs.readFileSync(path.join(dir, backups[0]), "utf8"))).to.deep.equal(items)
		// a second activation finds nothing to do and takes no second backup
		const before = JSON.stringify(h.history())
		expect(await h.service.ensureFallbackTitles()).to.equal(0)
		expect(JSON.stringify(h.history())).to.equal(before)
		expect(fs.readdirSync(dir).filter((f) => f.includes("bak-pre-titles-"))).to.have.length(1)
	})

	it("writes nothing when the backup cannot be taken", async () => {
		const h = harness([item("a")])
		h.deps.backup = async () => {
			throw new Error("disk full")
		}
		expect(await h.service.ensureFallbackTitles()).to.equal(0)
		expect(h.get("a").title).to.equal(undefined)
	})
})

describe("X1-P2 ChatTitleService: opt-in bulk titling", () => {
	it("is never started by anything but runBulk: construction, triggers and M2 make no call for earlier chats", async () => {
		const h = harness([item("a"), item("b", { titleSource: "fallback", title: "Fallback" })])
		await h.service.ensureFallbackTitles()
		await h.service.request("a", "first_turn")
		expect(h.calls).to.have.length(1) // only the live chat that asked
		expect(h.get("b").titleSource).to.equal("fallback")
	})

	it("titles only chats no model has titled and the user has not named, one at a time, and counts them", async () => {
		const h = harness([
			item("a", { titleSource: "fallback", title: "Fb" }),
			item("b"),
			item("c", { titleSource: "user", title: "Mine" }),
			item("d", { titleSource: "auto", title: "Done" }),
		])
		expect(h.service.bulkCandidates().map((x) => x.id)).to.deep.equal(["a", "b"])
		const r = await h.service.runBulk()
		expect(r).to.deep.equal({ status: "done", titled: 2, failed: 0, skipped: 0 })
		expect(h.calls).to.have.length(2)
		expect(h.get("a")).to.deep.include({ titleSource: "auto", titleRuns: 1 })
		expect(h.get("c")).to.deep.include({ title: "Mine", titleSource: "user" })
		expect(h.get("d").title).to.equal("Done")
		expect(h.service.bulkCandidates()).to.have.length(0)
	})

	it("(d) does nothing and calls no model with autoTitle off", async () => {
		const h = harness([item("a"), item("b")], { autoTitle: false })
		expect(await h.service.runBulk()).to.deep.include({ status: "disabled", titled: 0 })
		expect(h.calls).to.have.length(0)
	})

	it("a chat the user renames while the run is going keeps the user's title", async () => {
		const h = harness([item("a"), item("b")])
		const original = h.deps.call
		h.deps.call = async (s, u, sig) => {
			if (h.calls.length === 0) {
				h.service.rename("b", "Renamed meanwhile")
			}
			return original(s, u, sig)
		}
		await h.service.runBulk()
		expect(h.get("b")).to.deep.include({ title: "Renamed meanwhile", titleSource: "user" })
	})

	it("can be cancelled between chats and stops without writing the one in flight", async () => {
		const h = harness([item("a"), item("b"), item("c")])
		const original = h.deps.call
		let n = 0
		h.deps.call = async (s, u, sig) => {
			n++
			if (n === 2) {
				h.service.cancelBulk()
			}
			return original(s, u, sig)
		}
		const r = await h.service.runBulk()
		expect(r.status).to.equal("cancelled")
		expect(h.get("a").titleSource).to.equal("auto")
		expect(h.get("b").titleSource).to.equal(undefined)
		expect(h.get("c").titleSource).to.equal(undefined)
		// a second run is allowed afterwards
		expect((await h.service.runBulk()).status).to.equal("done")
	})

	it("refuses a second run while one is going", async () => {
		const h = harness([item("a")])
		const first = h.service.runBulk()
		expect((await h.service.runBulk()).status).to.equal("busy")
		await first
	})
})
