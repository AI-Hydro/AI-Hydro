import { expect } from "chai"
import { readFileSync } from "fs"
import { describe, it } from "mocha"
import * as path from "path"
import type { AiHydroMessage } from "../../ExtensionMessage"
import {
	ALL_ASK_KINDS,
	ALL_SAY_KINDS,
	classify,
	type DetailLevel,
	presentTranscript,
	type TranscriptItem,
	type WorkGroup,
} from "../transcriptPresenter"

// ── builders (mirror the shapes the host writes; invented data) ──
let clockN = 0
const T0 = 1_000_000
const nextTs = () => T0 + ++clockN * 1000
const reset = () => {
	clockN = 0
}
const say = (kind: NonNullable<AiHydroMessage["say"]>, text?: string, extra: Partial<AiHydroMessage> = {}) =>
	({ ts: nextTs(), type: "say", say: kind, text, ...extra }) as AiHydroMessage
const ask = (kind: NonNullable<AiHydroMessage["ask"]>, text?: string, extra: Partial<AiHydroMessage> = {}) =>
	({ ts: nextTs(), type: "ask", ask: kind, text, ...extra }) as AiHydroMessage
const req = (info: Record<string, unknown> = { cost: 0.01 }) => say("api_req_started", JSON.stringify({ tokensIn: 10, ...info }))
const mcpCall = (server = "srv", tool = "t") =>
	say("use_mcp_server", JSON.stringify({ serverName: server, type: "use_mcp_tool", toolName: tool, arguments: "{}" }))
const mcpResp = (body: unknown) => say("mcp_server_response", typeof body === "string" ? body : JSON.stringify(body))

const groups = (items: TranscriptItem[]) => items.filter((i): i is WorkGroup => i.kind === "group")
const lines = (g: WorkGroup) => g.lifted.map((l) => l.reason)
const present = (m: AiHydroMessage[], detail: DetailLevel = "normal") => presentTranscript(m, { detail })

describe("transcript presenter: classify", () => {
	it("is defined for every say and ask kind and falls back to passthrough", () => {
		for (const k of ALL_SAY_KINDS) {
			expect(classify(k, "say"), k).to.be.a("string")
		}
		for (const k of ALL_ASK_KINDS) {
			expect(classify(k, "ask"), k).to.be.a("string")
		}
		expect(classify("a_kind_from_the_future")).to.equal("passthrough")
		expect(classify("constructor")).to.equal("passthrough")
	})
	it("never folds the user-facing kinds", () => {
		for (const k of ["task", "error", "user_feedback"] as const) {
			expect(classify(k, "say")).to.equal("break")
		}
		expect(classify("text", "say")).to.equal("prose")
		expect(classify("completion_result", "say")).to.equal("answer")
		expect(classify("info", "say")).to.equal("lift")
	})
})

describe("transcript presenter: grouping", () => {
	it("makes one group from machinery and keeps prose, user turns and answers as their own items", () => {
		reset()
		const m = [
			say("task", "do it"),
			req(),
			say("reasoning", "thinking"),
			mcpCall(),
			mcpResp({ ok: true }),
			say("checkpoint_created", undefined, { lastCheckpointHash: "h" }),
			req(),
			say("text", "Here is what happened."),
			say("completion_result", "Done."),
		]
		const items = present(m)
		expect(items.map((i) => i.kind)).to.deep.equal(["user", "group", "prose", "answer"])
		const g = groups(items)[0]
		expect(g.facts.toolCount).to.equal(1)
		expect(g.facts.requestCount).to.equal(2)
		expect(g.rewindTs).to.equal(m[5].ts)
		expect(g.key).to.equal(`group:${m[1].ts}`)
		expect(g.facts.cost.label).to.equal("$0.0200")
	})
	it("empty or whitespace text never breaks a group", () => {
		reset()
		const items = present([
			say("task", "x"),
			req(),
			say("text", ""),
			mcpCall(),
			say("text", "  \n "),
			mcpResp({}),
			say("completion_result", ""),
		])
		expect(items.map((i) => i.kind)).to.deep.equal(["user", "group"])
	})
	it("lifted lines never split a group", () => {
		reset()
		const items = present([
			say("task", "x"),
			req(),
			mcpCall(),
			mcpResp("Error: boom"),
			say("info", "unrecognised thing"),
			say("diff_error", "no match"),
			req(),
			mcpCall(),
			mcpResp({ ok: true }),
		])
		expect(groups(items)).to.have.length(1)
		expect(lines(groups(items)[0])).to.include.members(["mcp_error", "unrecognised_info", "diff_error"])
	})
	it("breaks on a pending ask, an error and an answer audit; an answered ask folds", () => {
		reset()
		const answered = ask("command", "ls", { askOutcome: "approved", execOutcome: "completed", exitCode: 0 })
		const items = present([
			say("task", "x"),
			req(),
			answered,
			req(),
			say("error", "bad"),
			req(),
			ask("command", "pwd"), // pending (tail)
		])
		expect(items.map((i) => i.kind)).to.deep.equal(["user", "group", "error", "group", "pending"])
		expect(groups(items)[0].facts.toolCount).to.equal(1)
		expect(groups(items)[0].lifted).to.have.length(0)
	})
	it("answer_audit breaks the group and attaches the final audit to its answer", () => {
		reset()
		const answer = say("completion_result", "The answer.")
		const audit = say(
			"answer_audit",
			JSON.stringify({
				v: 1,
				stage: "final",
				status: "violations",
				violations: [{ kind: "k", severity: "hard" }],
				schema: "graded",
				attempt: 1,
				answerTs: answer.ts,
				draftHash: "abc",
				history: [{ attempt: 0 }],
			}),
		)
		const items = present([say("task", "x"), req(), answer, audit, req()])
		const a = items.find((i) => i.kind === "answer")
		expect(a && a.kind === "answer" && a.audit?.hardCount).to.equal(1)
		expect(items.map((i) => i.kind)).to.deep.equal(["user", "group", "answer", "group"])
	})
	it("surfaces a revision audit as a divider and counts it on the preceding group", () => {
		reset()
		const rev = say(
			"answer_audit",
			JSON.stringify({
				v: 1,
				stage: "revision",
				status: "violations",
				violations: [{ kind: "k", severity: "hard" }],
				schema: "graded",
				attempt: 1,
				answerTs: 1,
				draftHash: "d",
			}),
		)
		const items = present([say("task", "x"), req(), rev])
		expect(items.map((i) => i.kind)).to.deep.equal(["user", "group", "divider"])
		expect(groups(items)[0].facts.revisionCount).to.equal(1)
	})
	it("keeps browser sessions as passthrough items", () => {
		reset()
		const items = present([
			say("task", "x"),
			req(),
			say("browser_action_launch", "http://localhost:1"),
			say("browser_action", JSON.stringify({ action: "click" })),
			say("browser_action_result", "{}"),
			req(),
		])
		expect(items.map((i) => i.kind)).to.deep.equal(["user", "group", "passthrough", "group"])
		const p = items[2]
		expect(p.kind === "passthrough" && p.messages).to.have.length(3)
	})
	it("shows resume as a divider and a trailing resume ask as a pending prompt", () => {
		reset()
		const items = present([say("task", "x"), req(), ask("resume_task"), req(), ask("resume_task")])
		expect(items.map((i) => i.kind)).to.deep.equal(["user", "group", "divider", "group", "pending"])
	})
})

describe("transcript presenter: lifting", () => {
	const one = (rows: AiHydroMessage[]) => {
		const g = groups(present([say("task", "x"), req(), ...rows]))[0]
		return g ? lines(g) : []
	}
	it("lifts request failures and distinguishes user cancel from streaming failure", () => {
		reset()
		const out = groups(
			present([
				say("task", "x"),
				req({ cancelReason: "user_cancelled" }),
				req({ cancelReason: "streaming_failed", streamingFailedMessage: "socket closed" }),
				req({ cancelReason: "retries_exhausted" }),
			]),
		)[0]
		expect(lines(out)).to.deep.equal(["request_cancelled", "request_failed", "request_failed"])
		expect(out.lifted[1].text).to.contain("socket closed")
		expect(out.lifted[2].text).to.contain("retries")
		expect(out.facts.failedRequestCount).to.equal(2)
	})
	it("lifts MCP error shapes, blocking results and unpaired results", () => {
		reset()
		const shapes: unknown[] = [
			{ isError: true },
			{ error: "nope" },
			{ ok: false },
			{ status: "error" },
			"Error: failed",
			{ data: { a: { b: { blocking: true } } } },
		]
		for (const s of shapes) {
			reset()
			expect(one([mcpCall(), mcpResp(s)]), JSON.stringify(s)).to.have.lengthOf.at.least(1)
		}
		reset()
		expect(one([mcpResp({ fine: true })])).to.include("unpaired_result")
	})
	it("does not lift a benign error:false/ok:true result, and counts reuse", () => {
		reset()
		const g = groups(present([say("task", "x"), req(), mcpCall(), mcpResp({ error: false, ok: true, _cached: true })]))[0]
		expect(g.lifted).to.have.length(0)
		expect(g.facts.reuseCount).to.equal(1)
	})
	it("lifts refusals, area-check failures and provisional data", () => {
		reset()
		const r = one([mcpCall(), mcpResp({ error: true, code: "unknown_gauge", message: "no such gauge" })])
		expect(r).to.include("refusal")
		reset()
		expect(one([mcpCall(), mcpResp({ site_resolution: { area_check: "fail" } })])).to.include("area_check_failed")
		reset()
		expect(
			one([
				mcpCall(),
				mcpResp({ quality: { provisional_count: 3, provisional_total: 10, approval_counts: { Provisional: 3 } } }),
			]),
		).to.be.an("array")
	})
	it("lifts non-zero and unknown exit, denial, policy-classified and security-marked approvals", () => {
		reset()
		expect(one([say("command", "make", { exitCode: 2, execOutcome: "failed" })])).to.deep.equal(["exit_nonzero"])
		reset()
		expect(one([say("command", "make", { exitCode: "unknown", execOutcome: "unknown" })])).to.deep.equal(["exit_unknown"])
		reset()
		expect(one([ask("command", "rm x", { askOutcome: "denied" }), req()])).to.deep.equal(["call_denied"])
		reset()
		expect(one([say("command", "x", { policyClass: "auto_run_all", exitCode: 0, execOutcome: "completed" })])).to.deep.equal([
			"policy_command",
		])
		reset()
		const outside = ask("tool", JSON.stringify({ tool: "editedExistingFile", path: "/etc/hosts" }), {
			isOperationOutsideWorkspace: true,
			askOutcome: "approved",
			execOutcome: "completed",
		})
		expect(one([outside, req()])).to.deep.equal(["approved_security"])
	})
	it("uses the optional resolvers for effect class and protected paths", () => {
		reset()
		const m = [
			say("task", "x"),
			req(),
			ask("use_mcp_server", JSON.stringify({ serverName: "s", type: "use_mcp_tool", toolName: "t" }), {
				askOutcome: "approved",
			}),
			mcpResp({}),
			req(),
		]
		const plain = groups(presentTranscript(m, { detail: "normal" }))[0]
		expect(plain.lifted).to.have.length(0)
		const withResolver = groups(presentTranscript(m, { detail: "normal", effectClassFor: () => "UNKNOWN" }))[0]
		expect(lines(withResolver)).to.include("approved_security")
	})
	it("lifts truncation, condense, ignore/diff errors, shell warnings, checked-out checkpoint, rewind", () => {
		reset()
		const got = one([
			say("info", "Context window exceeded", { infoNotice: { class: "context_truncated", severity: "warning" } }),
			say("tool", JSON.stringify({ tool: "summarizeTask", content: "s" })),
			say("aihydroignore_error", "ignored"),
			say("diff_error", "d"),
			say("shell_integration_warning", "w"),
			say("checkpoint_created", undefined, { lastCheckpointHash: "h", isCheckpointCheckedOut: true }),
			say("deleted_api_reqs", "{}"),
			say("mcp_notification", "disk low", { mcpLevel: "warning" }),
		])
		expect(got).to.deep.equal([
			"context_truncated",
			"context_condensed",
			"ignore_error",
			"diff_error",
			"shell_integration",
			"checkpoint_checked_out",
			"rewind",
			"mcp_notification",
		])
	})
	it("folds quiet notices: a repaired native call and a quiet MCP notification", () => {
		reset()
		expect(
			one([say("info", "Repaired a native tool call (x)"), say("mcp_notification", "hi", { mcpLevel: "info" })]),
		).to.deep.equal([])
	})
	it("lifts malformed-retry and skipped legacy notices, and an unrecognised one", () => {
		reset()
		expect(
			one([
				say("info", "malformed tool call; retried\n\nraw"),
				say("info", "Skipped: 'x' is not a tool on 's'."),
				say("info", "novel"),
			]),
		).to.have.length(3)
	})
})

describe("transcript presenter: header facts", () => {
	it("never reports $0.0000 for unknown cost and labels lower bounds", () => {
		reset()
		const f = (rows: Array<Record<string, unknown>>) =>
			groups(present([say("task", "x"), ...rows.map((r) => req(r)), say("completion_result", "a")]))[0].facts.cost
		expect(f([{ costStatus: "unavailable" }])).to.include({ status: "unavailable", usd: null })
		expect(f([{}]).label).to.not.contain("0.0000")
		expect(f([{ cost: 0 }]).status).to.equal("unavailable")
		expect(f([{ cost: 0.02 }, { costStatus: "unavailable" }])).to.include({ status: "lower-bound" })
		expect(f([{ cost: 0.02, costStatus: "lower-bound" }]).label).to.contain("≥")
		expect(f([{ cost: 0.02 }, { cost: 0.03 }])).to.include({ status: "exact" })
	})
	it("splits agent time from waiting-for-you time using message timestamps", () => {
		const m: AiHydroMessage[] = [
			{ ts: 1000, type: "say", say: "task", text: "x" },
			{ ts: 2000, type: "say", say: "api_req_started", text: "{}" },
			{ ts: 3000, type: "ask", ask: "command", text: "ls", askOutcome: "approved" },
			{ ts: 13000, type: "say", say: "command_output", text: "a" },
			{ ts: 15000, type: "say", say: "api_req_started", text: "{}" },
		]
		const f = groups(present(m))[0].facts
		expect(f.waitingMs).to.equal(10000)
		expect(f.agentMs).to.equal(3000)
	})
	it("counts retries and calls only", () => {
		reset()
		const f = groups(
			present([
				say("task", "x"),
				req({ retryStatus: { attempt: 1, maxAttempts: 3, delaySec: 1 } }),
				say("api_req_retried", "retrying"),
				say("reasoning", "r"),
				say("command", "ls", { exitCode: 0, execOutcome: "completed" }),
			]),
		)[0].facts
		expect(f.retryCount).to.equal(2)
		expect(f.toolCount).to.equal(1)
		expect(f.liftedCount).to.equal(1)
	})
})

describe("transcript presenter: old tasks, streaming, verbose", () => {
	it("presents a task without outcome or notice fields and shows unknown calls neutrally", () => {
		reset()
		const m = [
			say("task", "old"),
			req(),
			ask("command", "ls\nOutput:\na", { commandCompleted: true }),
			req(),
			ask("use_mcp_server", JSON.stringify({ serverName: "s", type: "use_mcp_tool", toolName: "t" })),
			say("mcp_server_request_started"),
			mcpResp({ x: 1 }),
			req(),
			ask("tool", JSON.stringify({ tool: "readFile", path: "a.txt" })), // superseded, no evidence
			req(),
			say("text", "done"),
		]
		const g = groups(present(m))[0]
		expect(g.lifted).to.have.length(0)
		expect(g.facts.toolCount).to.equal(3)
	})
	it("keeps group keys stable while chunks are appended and text streams in", () => {
		reset()
		const full: AiHydroMessage[] = [
			say("task", "x"),
			req(),
			mcpCall(),
			mcpResp("Error: boom"),
			say("text", "ab"),
			req(),
			say("reasoning", "r"),
			say("completion_result", "final answer"),
		]
		const stable = (it: TranscriptItem) => it.kind !== "pending" && it.kind !== "passthrough"
		const keysOf = (m: AiHydroMessage[]) =>
			new Set(
				present(m)
					.filter(stable)
					.map((i) => i.key),
			)
		let prev = new Set<string>()
		for (let n = 1; n <= full.length; n++) {
			// every character of a streaming text row, starting from empty
			const last = full[n - 1]
			const variants =
				last.text && last.say === "text"
					? ["", ...last.text.split("").map((_, i) => last.text!.slice(0, i + 1))]
					: [last.text]
			for (const t of variants) {
				const m = [...full.slice(0, n - 1), { ...last, text: t, partial: true }]
				const keys = keysOf(m)
				for (const k of prev) {
					expect(keys.has(k), `${k} lost at n=${n} text=${JSON.stringify(t)}`).to.equal(true)
				}
			}
			prev = keysOf(full.slice(0, n))
		}
	})
	it("verbose is identity over the unfiltered list", () => {
		reset()
		const m = [say("task", "x"), req(), say("text", ""), say("error", "e")]
		const items = present(m, "verbose")
		expect(items).to.have.length(m.length)
		items.forEach((it, i) => {
			expect(it.kind).to.equal("passthrough")
			expect(it.kind === "passthrough" && it.messages[0]).to.equal(m[i])
		})
	})
})

describe("transcript presenter: no lift is ever only folded (every enum value)", () => {
	const surfaced = (items: TranscriptItem[], ts: number) =>
		items.some((it) =>
			it.kind === "group"
				? it.lifted.some((l) => l.sourceTs === ts)
				: it.kind === "passthrough"
					? it.messages.some((x) => x.ts === ts)
					: "message" in it && it.message.ts === ts,
		)
	for (const detail of ["focus", "normal"] as const) {
		for (const [type, kinds] of [
			["say", ALL_SAY_KINDS],
			["ask", ALL_ASK_KINDS],
		] as const) {
			for (const kind of kinds) {
				const c = classify(kind, type)
				if (c !== "lift" && c !== "break") {
					continue
				}
				it(`${detail}/${type}:${kind} (${c}) is surfaced`, () => {
					reset()
					const row = {
						ts: nextTs(),
						type,
						[type]: kind,
						text: kind === "answer_audit" ? "" : "unrecognised content",
					} as AiHydroMessage
					const items = present([say("task", "x"), req(), row, req(), say("text", "after")], detail)
					expect(surfaced(items, row.ts)).to.equal(true)
				})
			}
		}
	}
	it("a pending ask of every kind is shown as a prompt", () => {
		for (const kind of ALL_ASK_KINDS) {
			reset()
			const items = present([say("task", "x"), req(), ask(kind, "q")])
			expect(items[items.length - 1].kind, kind).to.equal("pending")
		}
	})
	it("an unknown kind is passthrough, never folded", () => {
		reset()
		const odd = { ts: nextTs(), type: "say", say: "future_kind", text: "?" } as unknown as AiHydroMessage
		const items = present([say("task", "x"), req(), odd])
		expect(items.some((i) => i.kind === "passthrough" && i.messages[0] === odd)).to.equal(true)
	})
})

describe("transcript presenter: source guards", () => {
	const src = readFileSync(path.join(__dirname, "..", "transcriptPresenter.ts"), "utf8")
	it("imports nothing from React, the webview or the host", () => {
		const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1])
		for (const spec of imports) {
			expect(spec, spec).to.match(/^\.\.?\//)
			expect(spec).to.not.match(/webview-ui|react|vscode|\/core\/|\/services\//)
		}
	})
	it("contains no tool-name literals", () => {
		const literals = [...src.matchAll(/["'`]([A-Za-z0-9_.-]+)["'`]/g)].map((m) => m[1])
		const forbidden =
			/^(delineate_basin|data_fetch|compute_signatures|extract_hydrologic_signatures|get_forcing|baseflow_separation|flow_duration_curve|trend_analysis|(get|compute|run|fetch|delineate|extract)_[a-z_]+)$/
		for (const l of literals) {
			expect(l, l).to.not.match(forbidden)
		}
	})
})
