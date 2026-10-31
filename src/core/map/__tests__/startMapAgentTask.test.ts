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

describe("map launch: the in-progress guard, and asking from the map", () => {
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

	describe("startMapAgentTask (P4: asking from the map keeps the chat)", () => {
		const deps = (added: string[] = [], delivered = true) => ({
			focusChat: async () => {},
			addToInput: async (text: string) => {
				added.push(text)
				return delivered
			},
		})

		it("never clears, aborts or replaces an open chat, running or finished; the text goes into its input", async () => {
			for (const open of [task({ ask: "tool" }), task({ say: "api_req_started" }), task({ say: "completion_result" })]) {
				const { c, log } = fakeController(open as any)
				const added: string[] = []
				const r = await startMapAgentTask(
					c,
					"long wrapped template",
					{
						composerText: "Why so small?",
						ref: { kind: "basin", layer_id: "l1", run_id: "run-1.1", lon: -90, lat: 40 },
					},
					deps(added),
				)
				expect(r).to.deep.include({ ok: true, addedToChat: true })
				expect(log).to.deep.equal([]) // no clearTask, no initTask
				expect(added).to.deep.equal(["Why so small? [map-ref kind=basin layer=l1 run=run-1.1 at=-90.00000,40.00000]"])
			}
		})

		it("with no ref and no short text, the whole prompt goes into the open chat's input", async () => {
			const { c, log } = fakeController(task({ say: "api_req_started" }) as any)
			const added: string[] = []
			await startMapAgentTask(c, "  the full prompt ", undefined, deps(added))
			expect(added).to.deep.equal(["the full prompt"])
			expect(log).to.deep.equal([])
		})

		it("a layer from another study: the note is in the input itself and the ref does not assert the study", async () => {
			const { c } = fakeController(task({ say: "api_req_started" }) as any)
			c.task.ulid = "chat-1"
			c.studyBinding = { chatId: "chat-1", status: "bound", studyId: "s-other", label: "Other study" }
			const added: string[] = []
			const r = await startMapAgentTask(
				c,
				"p",
				{ composerText: "Why?", ref: { kind: "basin", study_id: "s1" } },
				deps(added),
			)
			expect(r.addedToChat).to.equal(true)
			expect(r.warning).to.match(/study s1.*Other study/)
			expect(added[0]).to.match(
				/^Why\? \(This layer is from study s1; this chat is bound to Other study\.\) \[map-ref kind=basin\]$/,
			)
			expect(added[0]).to.not.match(/study=/)
			c.studyBinding = { chatId: "chat-1", status: "bound", studyId: "s1", label: "Same" }
			const same: string[] = []
			const r2 = await startMapAgentTask(c, "p", { ref: { kind: "basin", study_id: "s1" } }, deps(same))
			expect(r2.warning).to.equal(undefined)
			expect(same[0]).to.equal("[map-ref kind=basin study=s1]")
		})

		it("a chat bound to no study: the note says so and the study is not asserted", async () => {
			for (const binding of [
				undefined,
				{ chatId: "chat-1", status: "none", canChoose: true },
				{ chatId: "other-chat", status: "bound", studyId: "s1" },
			]) {
				const { c } = fakeController(task({ say: "api_req_started" }) as any)
				c.task.ulid = "chat-1"
				c.studyBinding = binding
				const added: string[] = []
				const r = await startMapAgentTask(c, "p", { ref: { kind: "basin", study_id: "s1" } }, deps(added))
				expect(added[0]).to.match(/not bound to a study/)
				expect(added[0]).to.not.match(/study=/)
				expect(r.warning).to.match(/not bound/)
			}
		})

		it("a ref with no study needs no note", async () => {
			const { c } = fakeController(task({ say: "api_req_started" }) as any)
			const added: string[] = []
			await startMapAgentTask(c, "p", { ref: { kind: "empty", lon: 1, lat: 2 } }, deps(added))
			expect(added[0]).to.equal("[map-ref kind=empty at=1.00000,2.00000]")
		})

		it("says nothing was added when no chat input received the text", async () => {
			const { c, log } = fakeController(task({ say: "api_req_started" }) as any)
			const r = await startMapAgentTask(c, "p", undefined, deps([], false))
			expect(r.ok).to.equal(false)
			expect(r.addedToChat).to.equal(undefined)
			expect(r.error).to.match(/nothing was added/)
			expect(log).to.deep.equal([])
		})

		it("with no chat open, starts one with the prompt and the launch (origin, question, study hint)", async () => {
			const { c, log } = fakeController(undefined)
			const r = await startMapAgentTask(
				c,
				"Ask about this outlet",
				{ userQuestion: " why so small? ", studyHint: { sessionId: "try" } },
				deps(),
			)
			expect(r).to.deep.equal({ ok: true })
			expect(log).to.deep.equal(["clearTask", "initTask"])
			expect(c.initArgs[5]).to.deep.equal({ origin: "map", userQuestion: "why so small?", studyHint: { sessionId: "try" } })
		})

		it("an aborted task is no open chat", async () => {
			const { c, log } = fakeController(task({ say: "text" }, true) as any)
			const r = await startMapAgentTask(c, "go", undefined, deps())
			expect(r.addedToChat).to.equal(undefined)
			expect(log).to.deep.equal(["clearTask", "initTask"])
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
		it("validates the ref and bounds the composer text", () => {
			const launch = parseMapLaunch({
				ref: { kind: "gauge", layer_id: "l1", run_id: "../x", lon: 5, lat: 400 },
				composerText: "x".repeat(2000),
			})
			expect(launch?.ref).to.deep.equal({ kind: "gauge", layer_id: "l1" })
			expect(launch?.composerText?.length).to.equal(1000)
			// invisible characters never reach the input
			expect(parseMapLaunch({ composerText: "a\u202Eb\u200Bc\u0000d", userQuestion: "q\u2066x" })).to.deep.equal({
				userQuestion: "q x",
				composerText: "a b c d",
			})
			expect(parseMapLaunch({ ref: { kind: "nonsense" } })).to.equal(undefined)
		})
	})
})
