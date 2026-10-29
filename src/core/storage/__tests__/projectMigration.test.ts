import type { HistoryItem } from "@shared/HistoryItem"
import { expect } from "chai"
import { describe, it } from "mocha"
import { patchHistory } from "../historyPatch"
import { describeMigration, earliestKnownDir, planProjectMigration, resolveProjects, summarizePlan } from "../projectMigration"

const item = (id: string, over: Partial<HistoryItem> = {}): HistoryItem => ({
	id,
	ts: 1,
	task: `secret title ${id}`,
	tokensIn: 0,
	tokensOut: 0,
	totalCost: 0,
	...over,
})

const exists = (dirs: string[]) => async (d: string) => dirs.includes(d)

/** A stand-in for ensure_project: one stable id per folder, and a log of calls. */
function fakeEnsure(existing: Record<string, string> = {}) {
	const ids = new Map(Object.entries(existing))
	const calls: string[] = []
	return {
		calls,
		ensure: async (dir: string) => {
			calls.push(dir)
			if (!ids.has(dir)) {
				ids.set(dir, `prj_${String(ids.size + 1).padStart(26, "0")}`)
			}
			return { ok: true as const, projectId: ids.get(dir)! }
		},
	}
}

describe("M1 project migration (X1-P1)", () => {
	describe("earliestKnownDir", () => {
		it("prefers cwdOnTaskInitialization (a creation field) over the checkpoint worktree (a loop field, rewritten on every save)", () => {
			expect(
				earliestKnownDir(item("a", { shadowGitConfigWorkTree: "/w/latest", cwdOnTaskInitialization: "/w/start" })),
			).to.deep.equal({ dir: "/w/start", source: "cwd" })
		})
		it("falls back to the checkpoint worktree only when the cwd is absent, and ignores relative or empty values", () => {
			expect(earliestKnownDir(item("a", { shadowGitConfigWorkTree: "/w/only/" }))).to.deep.equal({
				dir: "/w/only",
				source: "checkpoint",
			})
			expect(
				earliestKnownDir(item("b", { cwdOnTaskInitialization: "relative/dir", shadowGitConfigWorkTree: "" })),
			).to.equal(undefined)
		})
	})

	it("plans: groups by folder, leaves assigned items alone, sends missing and unrecorded folders to Unsorted", async () => {
		const history = [
			item("1", { cwdOnTaskInitialization: "/w/try" }),
			item("2", { cwdOnTaskInitialization: "/w/try/" }),
			item("3", { shadowGitConfigWorkTree: "/w/other" }),
			item("4", { cwdOnTaskInitialization: "/w/gone" }),
			item("5"),
			item("6", { cwdOnTaskInitialization: "/w/try", projectId: "prj_already" }),
		]
		const plan = await planProjectMigration(history, exists(["/w/try", "/w/other"]))
		expect(plan.total).to.equal(6)
		expect(plan.alreadyAssigned).to.equal(1)
		expect(plan.byDir).to.deep.equal([
			{ dir: "/w/try", itemIds: ["1", "2"] },
			{ dir: "/w/other", itemIds: ["3"] },
		])
		expect(plan.missingDir).to.deep.equal(["4"])
		expect(plan.noDir).to.deep.equal(["5"])
	})

	it("a dry-run summary is counts and folder names only: no chat title, no path", async () => {
		const history = [item("1", { cwdOnTaskInitialization: "/Users/someone/try" }), item("2")]
		const summary = summarizePlan(await planProjectMigration(history, exists(["/Users/someone/try"])))
		expect(summary).to.deep.equal({
			total: 2,
			alreadyAssigned: 0,
			wouldAssign: 1,
			projects: [{ folder: "try", chats: 1 }],
			unsorted: { noFolderRecorded: 1, folderMissing: 0, total: 1 },
		})
		expect(JSON.stringify(summary)).to.not.include("secret title")
		expect(JSON.stringify(summary)).to.not.include("/Users/someone")
	})

	it("is idempotent: the second run changes nothing and asks the server for nothing", async () => {
		let history = [
			item("1", { cwdOnTaskInitialization: "/w/try", isFavorited: true, title: "kept" }),
			item("2", { cwdOnTaskInitialization: "/w/try" }),
			item("3", { cwdOnTaskInitialization: "/w/gone" }),
			item("4"),
		]
		const server = fakeEnsure()
		const run = async () => {
			const plan = await planProjectMigration(history, exists(["/w/try"]))
			if (plan.byDir.length === 0) {
				return { plan, assigned: 0 }
			}
			const result = await resolveProjects(plan, server.ensure)
			for (const a of result.assignments) {
				history = patchHistory(history, { id: a.itemId, projectId: a.projectId }, "system").history
			}
			return { plan, assigned: result.assignments.length }
		}
		expect((await run()).assigned).to.equal(2)
		const afterFirst = JSON.stringify(history)
		const callsAfterFirst = server.calls.length

		const second = await run()
		expect(second.assigned).to.equal(0)
		expect(JSON.stringify(history)).to.equal(afterFirst)
		expect(server.calls.length).to.equal(callsAfterFirst) // no further server call
		// other fields survive, and the two chats of one folder share one project
		expect(history[0]).to.include({ isFavorited: true, title: "kept" })
		expect(history[0].projectId).to.equal(history[1].projectId)
		expect(history[2].projectId).to.equal(undefined)
		expect(history[3].projectId).to.equal(undefined)
	})

	it("never changes a stored projectId, even when the plan is applied over it (first value wins)", () => {
		const stored = [item("1", { projectId: "prj_first" })]
		const next = patchHistory(stored, { id: "1", projectId: "prj_second" }, "system").history
		expect(next[0].projectId).to.equal("prj_first")
	})

	it("one distinct folder costs one server call", async () => {
		const history = [1, 2, 3].map((n) => item(String(n), { cwdOnTaskInitialization: "/w/try" }))
		const server = fakeEnsure()
		await resolveProjects(await planProjectMigration(history, exists(["/w/try"])), server.ensure)
		expect(server.calls).to.deep.equal(["/w/try"])
	})

	it("an absent or old server stops the run after one call; the chats stay unassigned for the next activation", async () => {
		const history = [item("1", { cwdOnTaskInitialization: "/w/a" }), item("2", { cwdOnTaskInitialization: "/w/b" })]
		const calls: string[] = []
		const result = await resolveProjects(await planProjectMigration(history, exists(["/w/a", "/w/b"])), async (dir) => {
			calls.push(dir)
			return { ok: false, code: "OLD_SERVER", reason: "Projects need AI-Hydro tools >= 2.8.3." }
		})
		expect(calls).to.deep.equal(["/w/a"])
		expect(result.assignments).to.have.length(0)
		expect(result.stoppedEarly).to.equal(true)
		expect(result.failed.map((f) => f.folder)).to.deep.equal(["a", "b"])
	})

	it("one folder failing does not stop the others, and a throw is a failure, not a crash", async () => {
		const history = [item("1", { cwdOnTaskInitialization: "/w/a" }), item("2", { cwdOnTaskInitialization: "/w/b" })]
		const result = await resolveProjects(await planProjectMigration(history, exists(["/w/a", "/w/b"])), async (dir) => {
			if (dir === "/w/a") {
				throw new Error("boom")
			}
			return { ok: true, projectId: "prj_b" }
		})
		expect(result.assignments).to.deep.equal([{ itemId: "2", projectId: "prj_b" }])
		expect(result.failed).to.have.length(1)
		expect(result.failed[0]).to.include({ folder: "a", code: "FAILED" })
	})

	it("the notice states what is lost: chats whose folder moved stay in Unsorted", async () => {
		const history = [item("1", { cwdOnTaskInitialization: "/w/try" }), item("2", { cwdOnTaskInitialization: "/w/gone" })]
		const plan = await planProjectMigration(history, exists(["/w/try"]))
		const text = describeMigration(plan, await resolveProjects(plan, fakeEnsure().ensure))
		expect(text).to.include("1 earlier chat grouped into 1 project")
		expect(text).to.include("1 stay in Unsorted")
		expect(text).to.include("moved")
	})
})
