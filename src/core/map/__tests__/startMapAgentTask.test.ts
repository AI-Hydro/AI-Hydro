import { expect } from "chai"
import { describe, it } from "mocha"
import { parseMapLaunch } from "../handleMapAgentTask"
import { isChatInProgress } from "../launchGuard"
import { startMapAgentTask } from "../startMapAgentTask"

const task = (last?: { ask?: string; say?: string }, abort = false) => ({
	taskState: { abort },
	messageStateHandler: { getAiHydroMessages: () => (last ? [{ say: "task" }, last] : []) },
})

function fakeController(running: ReturnType<typeof task> | undefined) {
	const log: string[] = []
	const c: any = {
		task: running,
		clearTask: async () => {
			log.push("clearTask")
		},
		postStateToWebview: async () => {},
		initTask: async (...args: unknown[]) => {
			log.push("initTask")
			;(c as any).initArgs = args
			return "t"
		},
	}
	return { c, log }
}

describe("map launch guard (X0-2: never silently abort a running chat)", () => {
	describe("isChatInProgress", () => {
		it("no task, an aborted task and a completed chat have nothing to lose", () => {
			expect(isChatInProgress(undefined)).to.equal(false)
			expect(isChatInProgress(task({ say: "text" }, true))).to.equal(false)
			expect(isChatInProgress(task({ ask: "completion_result" }))).to.equal(false)
			expect(isChatInProgress(task({ say: "completion_result" }))).to.equal(false)
		})
		it("a working chat, a pending ask and a task that has said nothing yet are in progress", () => {
			expect(isChatInProgress(task({ say: "api_req_started" }))).to.equal(true)
			expect(isChatInProgress(task({ ask: "command" }))).to.equal(true)
			expect(isChatInProgress(task(undefined))).to.equal(true)
		})
	})

	describe("startMapAgentTask", () => {
		it("does not touch a running chat when the user declines", async () => {
			const { c, log } = fakeController(task({ ask: "tool" }) as any)
			const r = await startMapAgentTask(c, "Delineate here", undefined, {
				confirmReplace: async () => false,
				focusChat: async () => {},
			})
			expect(r).to.deep.include({ ok: false, cancelled: true })
			expect(log).to.deep.equal([]) // no clearTask, no initTask
		})

		it("replaces the chat only after the user confirms, and passes the launch (origin, question, study hint)", async () => {
			const { c, log } = fakeController(task({ say: "api_req_started" }) as any)
			const r = await startMapAgentTask(
				c,
				"Ask about this outlet",
				{ userQuestion: " why so small? ", studyHint: { sessionId: "try" } },
				{ confirmReplace: async () => true, focusChat: async () => {} },
			)
			expect(r.ok).to.equal(true)
			expect(log).to.deep.equal(["clearTask", "initTask"])
			expect(c.initArgs[5]).to.deep.equal({ origin: "map", userQuestion: "why so small?", studyHint: { sessionId: "try" } })
		})

		it("a finished or absent chat needs no confirmation", async () => {
			for (const t of [undefined, task({ say: "completion_result" }) as any]) {
				const { c, log } = fakeController(t)
				const r = await startMapAgentTask(c, "go", undefined, {
					confirmReplace: async () => {
						throw new Error("must not ask")
					},
					focusChat: async () => {},
				})
				expect(r.ok).to.equal(true)
				expect(log).to.deep.equal(["clearTask", "initTask"])
			}
		})

		it("rejects an empty prompt", async () => {
			const { c } = fakeController(undefined)
			expect((await startMapAgentTask(c, "   ")).ok).to.equal(false)
		})
	})

	describe("parseMapLaunch (the hint comes from a webview)", () => {
		it("keeps bounded strings only", () => {
			expect(parseMapLaunch({ sessionId: " try ", artifactPath: "/w/a.geojson", userQuestion: "q" })).to.deep.equal({
				userQuestion: "q",
				studyHint: { sessionId: "try", artifactPath: "/w/a.geojson" },
			})
			expect(parseMapLaunch({ sessionId: 5, artifactPath: "x".repeat(2000) })).to.equal(undefined)
			expect(parseMapLaunch(undefined)).to.equal(undefined)
			expect(parseMapLaunch("try")).to.equal(undefined)
		})
	})
})
