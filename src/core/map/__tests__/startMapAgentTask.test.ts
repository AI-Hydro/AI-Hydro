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

	describe("startMapAgentTask (P4: asking from the map keeps the chat)", () => {
		const deps = (added: string[] = []) => ({
			confirmReplace: async () => {
				throw new Error("must not ask: the map no longer replaces a chat")
			},
			focusChat: async () => {},
			addToInput: async (text: string) => void added.push(text),
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
						ref: { kind: "basin", layer_id: "l1", run_id: "run-1.1", study_id: "s1", lon: -90, lat: 40 },
					},
					deps(added),
				)
				expect(r).to.deep.include({ ok: true, addedToChat: true })
				expect(log).to.deep.equal([]) // no clearTask, no initTask
				expect(added).to.deep.equal([
					"Why so small? [map-ref kind=basin layer=l1 run=run-1.1 study=s1 at=-90.00000,40.00000]",
				])
			}
		})

		it("with no ref and no short text, the whole prompt goes into the open chat's input", async () => {
			const { c, log } = fakeController(task({ say: "api_req_started" }) as any)
			const added: string[] = []
			await startMapAgentTask(c, "  the full prompt ", undefined, deps(added))
			expect(added).to.deep.equal(["the full prompt"])
			expect(log).to.deep.equal([])
		})

		it("says so when the layer's study is not the chat's, and still adds the text", async () => {
			const { c } = fakeController(task({ say: "api_req_started" }) as any)
			c.task.ulid = "chat-1"
			c.studyBinding = { chatId: "chat-1", status: "bound", studyId: "s-other", label: "Other study" }
			const r = await startMapAgentTask(c, "p", { ref: { kind: "basin", study_id: "s1" } }, deps())
			expect(r.addedToChat).to.equal(true)
			expect(r.warning).to.match(/study s1.*Other study/)
			c.studyBinding = { chatId: "chat-1", status: "bound", studyId: "s1", label: "Same" }
			expect((await startMapAgentTask(c, "p", { ref: { kind: "basin", study_id: "s1" } }, deps())).warning).to.equal(
				undefined,
			)
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
			expect(parseMapLaunch({ ref: { kind: "nonsense" } })).to.equal(undefined)
		})
	})
})
