import { presentTranscript } from "@shared/aihydro/transcriptPresenter"
import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { getApiMetrics } from "@shared/getApiMetrics"
import { describe, expect, it } from "vitest"
import { buildTranscriptView, filterVisibleMessages, groupMessages, processMessages } from "../../chat-view/utils/messageUtils"

let ts = 1_000
const say = (s: AiHydroMessage["say"], text?: string, extra: Partial<AiHydroMessage> = {}): AiHydroMessage => ({
	ts: (ts += 1000),
	type: "say",
	say: s,
	text,
	...extra,
})
const ask = (a: AiHydroMessage["ask"], text?: string): AiHydroMessage => ({ ts: (ts += 1000), type: "ask", ask: a, text })
const req = () => say("api_req_started", JSON.stringify({ request: "r", tokensIn: 10, tokensOut: 5, cost: 0.01 }))

/** A plain chat turn: the model answers without a tool. Machinery before and after the answer, as a real run writes. */
const plainTurn = (question: string): AiHydroMessage[] => [
	say("task", question),
	req(),
	say("checkpoint_created"),
	say("completion_result", "A flow-duration curve ranks streamflow."),
	say("checkpoint_created"),
	req(),
]

const view = (msgs: AiHydroMessage[], detail: "focus" | "normal" | "verbose", running = false) =>
	buildTranscriptView(processMessages(msgs), groupMessages(filterVisibleMessages(msgs)), { detail, running })

const kinds = (v: ReturnType<typeof view>) => v.entries.map((e) => (e.mode === "presented" ? e.item.kind : "legacy"))

describe("empty work groups are not rows", () => {
	it("sanity: the presenter does produce the empty groups the view then drops", () => {
		const items = presentTranscript(processMessages(plainTurn("q")), { detail: "normal" })
		expect(items.filter((i) => i.kind === "group").length).toBeGreaterThan(0)
	})

	for (const detail of ["focus", "normal"] as const) {
		it(`${detail}: a plain answered turn shows the question and the answer, no Worked row`, () => {
			const v = view(plainTurn("Explain flow duration curves."), detail)
			expect(kinds(v)).toEqual(["user", "answer"])
		})

		it(`${detail}: the trailing group after a completed answer is not shown`, () => {
			const v = view(
				[...plainTurn("q1"), ask("completion_result", ""), ask("resume_completed_task"), say("user_feedback", "q2")],
				detail,
			)
			expect(kinds(v)).not.toContain("group")
			expect(kinds(v)).not.toContain("divider")
		})

		it(`${detail}: the turn's checkpoint still backs "Rewind to this message"`, () => {
			const msgs = plainTurn("Explain.")
			const v = view(msgs, detail)
			const user = v.entries[0]
			expect(v.rewinds.get(user.key)).toBe(msgs.find((m) => m.say === "checkpoint_created")?.ts)
		})
	}

	it("the task header total still includes the cost of the dropped rows (it is computed from the messages, not the view)", () => {
		const msgs = plainTurn("q") // two requests at $0.01
		expect(kinds(view(msgs, "normal"))).toEqual(["user", "answer"])
		expect(getApiMetrics(processMessages(msgs)).totalCost).toBeCloseTo(0.02, 6)
	})

	it("a checkpoint after the answer has no row and no target (documented loss); the turn's first one does", () => {
		const msgs = plainTurn("q")
		const cps = msgs.filter((m) => m.say === "checkpoint_created")
		const v = view(msgs, "normal")
		expect([...v.rewinds.values()]).toEqual([cps[0].ts])
	})

	it("a group with tool work is kept", () => {
		const msgs = [
			say("task", "Run it"),
			req(),
			say("command", "ls"),
			say("command_output", "a"),
			say("completion_result", "Done."),
		]
		expect(kinds(view(msgs, "normal"))).toContain("group")
	})

	it("a group with a failed request is kept (it says something went wrong)", () => {
		const msgs = [
			say("task", "q"),
			say(
				"api_req_started",
				JSON.stringify({ request: "r", cancelReason: "streaming_failed", streamingFailedMessage: "boom" }),
			),
			say("error_retry", JSON.stringify({ attempt: 1, maxAttempts: 3, delaySec: 1 })),
			say("completion_result", "ok"),
		]
		const v = view(msgs, "normal")
		const groups = v.entries.filter((e) => e.mode === "presented" && e.item.kind === "group")
		expect(groups.length).toBe(1)
	})

	it("the live tail group stays while the task runs (it is the Working row) and goes when it stops", () => {
		const msgs = [say("task", "q"), req()]
		expect(kinds(view(msgs, "normal", true))).toEqual(["user", "group"])
		expect(kinds(view(msgs, "normal", false))).toEqual(["user"])
	})

	it("verbose is untouched: it is today's raw rows", () => {
		const v = view(plainTurn("q"), "verbose")
		expect(v.entries.every((e) => e.mode === "legacy")).toBe(true)
	})

	it("an interrupted task still gets its divider", () => {
		const msgs = [say("task", "q"), req(), ask("resume_task"), say("user_feedback", "continue")]
		expect(kinds(view(msgs, "normal"))).toContain("divider")
	})
})
