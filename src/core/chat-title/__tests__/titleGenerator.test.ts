import type { ApiConfiguration } from "@shared/api"
import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { expect } from "chai"
import { describe, it } from "mocha"
import { exchangeFromMessages } from "../chatExchange"
import { buildTitleRequest, generateTitle, parseTitleReply, TITLE_INPUT_CHAR_BUDGET } from "../titleGenerator"
import { withTitleModel } from "../titleModelConfig"

const ON = { autoTitle: true }
const OFF = { autoTitle: false }

function counting(reply: string | Error) {
	const calls: Array<{ system: string; user: string }> = []
	const call = async (system: string, user: string) => {
		calls.push({ system, user })
		if (reply instanceof Error) {
			throw reply
		}
		return reply
	}
	return { call, calls }
}

describe("X1-P2 title generator", () => {
	it("(d) with autoTitle off no model is called, and the deterministic title is returned", async () => {
		const { call, calls } = counting('{"title":"Should not be used"}')
		const r = await generateTitle({ input: { task: "Compare baseflow in two synthetic basins" }, settings: OFF, call })
		expect(calls).to.have.length(0)
		expect(r).to.deep.include({ source: "fallback", modelCalled: false, title: "Compare baseflow in two synthetic basins" })
	})

	it("a valid reply becomes an automatic title and description", async () => {
		const { call, calls } = counting(
			'```json\n{"title":"Baseflow in two synthetic basins","description":"Compares the baseflow index of two synthetic basins."}\n```',
		)
		const r = await generateTitle({
			input: { task: "Compare baseflow", firstAssistantText: "Here is the comparison" },
			settings: ON,
			call,
		})
		expect(calls).to.have.length(1)
		expect(r).to.deep.include({ source: "auto", modelCalled: true, title: "Baseflow in two synthetic basins" })
		expect(r.description).to.equal("Compares the baseflow index of two synthetic basins.")
	})

	it("a reply that fails the check (id, decimal, long, not JSON) falls back to the deterministic title", async () => {
		for (const reply of [
			'{"title":"Basin 01031500 overview"}',
			'{"title":"NSE 0.82 for the basin"}',
			`{"title":"${"long ".repeat(20)}"}`,
			"A plain sentence, not JSON",
			'{"title": 5}',
			"",
		]) {
			const { call } = counting(reply)
			const r = await generateTitle({ input: { task: "Compare baseflow" }, settings: ON, call })
			expect(r.source, reply).to.equal("fallback")
			expect(r.modelCalled).to.equal(true)
			expect(r.title).to.equal("Compare baseflow")
		}
	})

	it("a good title with a bad description keeps the title and drops the description", async () => {
		const { call } = counting('{"title":"Baseflow trends","description":"NSE was 0.82 here."}')
		const r = await generateTitle({ input: { task: "x y" }, settings: ON, call })
		expect(r).to.deep.include({ source: "auto", title: "Baseflow trends" })
		expect(r.description).to.equal(undefined)
	})

	it("an error or a timeout gives the fallback; a cancel gives nothing to write", async () => {
		const failed = await generateTitle({
			input: { task: "Compare baseflow" },
			settings: ON,
			call: counting(new Error("boom")).call,
		})
		expect(failed).to.deep.include({ source: "fallback", modelCalled: true })

		const slow = (_s: string, _u: string, signal: AbortSignal) =>
			new Promise<string>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))
		const timedOut = await generateTitle({ input: { task: "Compare baseflow" }, settings: ON, call: slow, timeoutMs: 20 })
		expect(timedOut).to.deep.include({ source: "fallback", modelCalled: true })
		expect(timedOut.cancelled).to.equal(undefined)

		const controller = new AbortController()
		const pending = generateTitle({
			input: { task: "Compare baseflow" },
			settings: ON,
			call: slow,
			signal: controller.signal,
		})
		controller.abort()
		expect((await pending).cancelled).to.equal(true)

		const already = new AbortController()
		already.abort()
		const { call, calls } = counting('{"title":"x"}')
		expect((await generateTitle({ input: { task: "a b" }, settings: ON, call, signal: already.signal })).cancelled).to.equal(
			true,
		)
		expect(calls).to.have.length(0)
	})

	it("no text at all means no call (nothing to go on)", async () => {
		const { call, calls } = counting('{"title":"Guess"}')
		const r = await generateTitle({
			input: { origin: "map", task: "The user clicked the AI-Hydro map and wants hydrology help" },
			settings: ON,
			call,
		})
		expect(calls).to.have.length(1) // the map note is something to go on
		expect(r.source).to.equal("auto")
		const none = counting('{"title":"Guess"}')
		const r2 = await generateTitle({ input: { task: "" }, settings: ON, call: none.call })
		expect(none.calls).to.have.length(0)
		expect(r2.title).to.equal("Untitled chat")
	})
})

describe("X1-P2 title request", () => {
	it("uses the recorded question for a map launch, never the wrapped prompt; study name without its id; bounded", () => {
		const wrapped = "The user clicked the AI-Hydro map ... ## Visible Map Layers ... lat 12.34567"
		const { user, system } = buildTitleRequest({
			origin: "map",
			userQuestion: "Why is the low flow flat?",
			task: wrapped,
			studyLabel: "Synthetic Creek near Testville, XX (USGS 01234567)",
			firstAssistantText: "x".repeat(10_000),
			toolNames: ["delineate_watershed", "bad name with spaces", "get_streamflow"],
		})
		expect(user).to.contain("Why is the low flow flat?")
		expect(user).to.not.contain("clicked the AI-Hydro map")
		expect(user).to.contain("Study: Synthetic Creek near Testville, XX")
		expect(user).to.not.contain("01234567")
		expect(user).to.contain("Tools used: delineate_watershed, get_streamflow")
		expect(user.length).to.be.at.most(TITLE_INPUT_CHAR_BUDGET)
		expect(system).to.contain("Never write an identifier")
	})

	it("parses a fenced or surrounded JSON object and refuses the rest", () => {
		expect(parseTitleReply('Sure: {"title":"A","description":"B"} done')).to.deep.equal({ title: "A", description: "B" })
		expect(parseTitleReply("no json")).to.equal(undefined)
		expect(parseTitleReply("{broken")).to.equal(undefined)
		expect(parseTitleReply('{"description":"only"}')).to.equal(undefined)
	})
})

describe("X1-P2 what a title is made from", () => {
	const msg = (m: Partial<AiHydroMessage>): AiHydroMessage => ({ ts: 1, type: "say", ...m }) as AiHydroMessage

	it("reads the first reply and tool names, never tool arguments or results", () => {
		const ex = exchangeFromMessages([
			msg({ say: "task", text: "the task" }),
			msg({ say: "text", text: "partial", partial: true }),
			msg({ say: "text", text: "First reply" }),
			msg({
				type: "ask",
				ask: "use_mcp_server",
				text: JSON.stringify({
					type: "use_mcp_tool",
					serverName: "s",
					toolName: "get_streamflow",
					arguments: '{"gauge":"01031500"}',
				}),
			}),
			msg({ say: "mcp_server_response", text: "SECRET RESULT 12.5 mm" }),
			msg({ say: "tool", text: JSON.stringify({ tool: "readFile", path: "a.txt", content: "SECRET FILE" }) }),
		])
		expect(ex.firstAssistantText).to.equal("First reply")
		expect(ex.toolNames).to.deep.equal(["get_streamflow", "readFile"])
		expect(JSON.stringify(ex)).to.not.contain("SECRET")
		expect(JSON.stringify(ex)).to.not.contain("01031500")
	})
})

describe("X1-P2 title model configuration", () => {
	const base = {
		actModeApiProvider: "anthropic",
		actModeApiModelId: "chat-model",
		actModeOpenRouterModelId: "chat-model",
		planModeApiModelId: "plan-model",
		apiKey: "k",
	} as unknown as ApiConfiguration

	it("with no titleModel the chat's own configuration is used unchanged", () => {
		expect(withTitleModel(base, "act", "")).to.equal(base)
		expect(withTitleModel(base, "act", undefined)).to.equal(base)
	})

	it("replaces the model id of the mode in use, on the same provider and key, without touching the input", () => {
		const next = withTitleModel(base, "act", " small-model ") as any
		expect(next.actModeApiModelId).to.equal("small-model")
		expect(next.actModeOpenRouterModelId).to.equal("small-model")
		expect(next.planModeApiModelId).to.equal("plan-model")
		expect(next.actModeApiProvider).to.equal("anthropic")
		expect(next.apiKey).to.equal("k")
		expect((base as any).actModeApiModelId).to.equal("chat-model")
	})
})
