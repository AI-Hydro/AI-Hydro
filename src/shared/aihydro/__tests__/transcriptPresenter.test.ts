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
// Resolvers that say "nothing risky" so tests of other behaviour are not drowned by the fail-safe lifting.
const SAFE = { effectClassFor: () => "READ" as const, isProtectedPath: () => false }
const present = (m: AiHydroMessage[], detail: DetailLevel = "normal") => presentTranscript(m, { detail, ...SAFE })

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
		const plain = groups(presentTranscript(m, { detail: "normal", ...SAFE }))[0]
		expect(plain.lifted).to.have.length(0)
		const withResolver = groups(presentTranscript(m, { detail: "normal", ...SAFE, effectClassFor: () => "UNKNOWN" }))[0]
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
		expect(f([{ cost: 0 }]).status).to.equal("unrecorded")
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
	it("presents a task without outcome or notice fields; undecided calls are neutral", () => {
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
		// A task from before outcomes were recorded: an ask without an outcome is old data, shown neutrally.
		expect(g.lifted).to.have.length(0)
		expect(g.facts.toolCount).to.equal(3)
		expect(g.facts.notRunCount).to.equal(0)
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

// ── Review round: fail-safe security lifting, real failure shapes, honest header ──

const lifted = (rows: AiHydroMessage[], opts: Partial<Parameters<typeof presentTranscript>[1]> = {}) => {
	const g = groups(presentTranscript([say("task", "x"), req(), ...rows], { detail: "normal", ...opts }))
	return g.flatMap((x) => x.lifted)
}

describe("transcript presenter: security approvals fail safe (B1)", () => {
	const approvedMcp = () =>
		ask("use_mcp_server", JSON.stringify({ serverName: "s", toolName: "delete_all" }), { askOutcome: "approved" })
	const approvedEdit = (p: string) =>
		ask("tool", JSON.stringify({ tool: "editedExistingFile", path: p, diff: "x" }), { askOutcome: "approved" })
	it("lifts an approved MCP call when no effect resolver is given, or it returns undefined", () => {
		reset()
		expect(lifted([approvedMcp(), mcpResp({ ok: true })]).map((l) => l.reason)).to.deep.equal(["approved_security"])
		reset()
		expect(
			lifted([approvedMcp(), mcpResp({ ok: true })], { effectClassFor: () => undefined }).map((l) => l.reason),
		).to.deep.equal(["approved_security"])
		reset()
		expect(lifted([approvedMcp(), mcpResp({ ok: true })], { effectClassFor: () => "READ" })).to.have.length(0)
	})
	it("lifts an approved or auto-run write that names a path when no path resolver is given", () => {
		reset()
		expect(lifted([approvedEdit(".env"), req()]).map((l) => l.reason)).to.deep.equal(["approved_security"])
		reset()
		const auto = say("tool", JSON.stringify({ tool: "editedExistingFile", path: ".aihydroignore", diff: "x" }))
		expect(lifted([auto]).map((l) => l.reason)).to.deep.equal(["approved_security"])
		reset()
		expect(lifted([approvedEdit("src/a.ts"), req()], { isProtectedPath: () => false })).to.have.length(0)
		reset()
		expect(lifted([approvedEdit(".env"), req()], { isProtectedPath: (x) => x === ".env" })).to.have.length(1)
	})
	it("does not lift a read-type native call that names a path", () => {
		reset()
		const read = ask("tool", JSON.stringify({ tool: "readFile", path: "a.txt" }), { askOutcome: "approved" })
		expect(lifted([read, req()])).to.have.length(0)
	})
})

describe("transcript presenter: real failure shapes (B2, N1, N2, N6, N7)", () => {
	const shapes: Array<[string, unknown]> = [
		["status failed", { status: "failed" }],
		["status FAILED", { status: "FAILED" }],
		["status cancelled", { status: "cancelled" }],
		["status canceled", { status: "canceled" }],
		["status corrupt", { status: "corrupt" }],
		["status timeout", { status: "timeout" }],
		["status timed_out", { status: "timed_out" }],
		["status unavailable", { status: "Unavailable" }],
		["status error", { status: "Error" }],
		["nested status failed", { data: { status: "failed" } }],
		["status inside array", { jobs: [{ status: "ok" }, { status: "failed" }] }],
		["success false", { success: false }],
		["ok false deep", { result: { data: { ok: false } } }],
		["isError deep", { content: [{ type: "text" }], result: { inner: { isError: true } } }],
		["error object", { error: { code: -32603 } }],
		["top-level array", [{ isError: true }]],
		["blocking beyond old depth", { a: { b: { c: { d: { blocking: true } } } } }],
		["blocking string", { blocking: "true" }],
		["blocking after 60 array items", { a: [...Array(60).fill({}), { blocking: true }] }],
		["area_check FAIL", { area_check: "FAIL" }],
		["area_check failed", { area_check: "failed" }],
		["text Error", "Error: boom"],
		["text lowercase", "error: boom"],
		["text Error code", "Error -32603: boom"],
		["text MCP error", "MCP error -32603: boom"],
		["text Failed", "Failed: boom"],
		["text [ERROR]", "[ERROR] boom"],
		["text BOM", "\uFEFFError: x"],
		["text traceback", "Traceback (most recent call last):\n ValueError"],
	]
	for (const [name, body] of shapes) {
		it(`lifts: ${name}`, () => {
			reset()
			expect(lifted([mcpCall(), mcpResp(body)]).length, name).to.be.at.least(1)
		})
	}
	const benign: Array<[string, unknown]> = [
		["error false", { error: false, ok: true, success: true }],
		["status ok", { status: "ok" }],
		["blocking false", { blocking: false }],
		["text mentioning error later", "Result: no error found"],
	]
	for (const [name, body] of benign) {
		it(`does not lift: ${name}`, () => {
			reset()
			expect(lifted([mcpCall(), mcpResp(body)], SAFE), name).to.have.length(0)
		})
	}
	it("lifts a result too deep to inspect rather than assuming it is fine", () => {
		reset()
		let deep: unknown = { leaf: 1 }
		for (let i = 0; i < 20; i++) {
			deep = { n: deep }
		}
		expect(lifted([mcpCall(), mcpResp(deep)], SAFE).map((l) => l.reason)).to.deep.equal(["result_uninspected"])
	})
	it("a warning-tone result line does not swallow a failed call", () => {
		reset()
		const failed = { ...mcpCall(), execOutcome: "failed" as const }
		const out = lifted([failed, mcpResp({ blocking: true })], SAFE).map((l) => l.reason)
		expect(out).to.include.members(["call_failed", "blocking"])
		reset()
		const out2 = lifted([{ ...mcpCall(), execOutcome: "failed" as const }, mcpResp("Error: x")], SAFE).map((l) => l.reason)
		expect(out2).to.deep.equal(["mcp_error"])
	})
	it("lifts one line, not two, for an error that is also a refusal", () => {
		reset()
		const out = lifted([mcpCall(), mcpResp({ error: true, code: "X", message: "m" })], SAFE).map((l) => l.reason)
		expect(out).to.deep.equal(["refusal"])
	})
	it("counts reuse only at the top level or under data", () => {
		reset()
		const f = (b: unknown) =>
			groups(presentTranscript([say("task", "x"), req(), mcpCall(), mcpResp(b)], { detail: "normal", ...SAFE }))[0].facts
				.reuseCount
		expect(f({ _cached: true })).to.equal(1)
		expect(f({ data: { reused: true } })).to.equal(1)
		expect(f({ rows: [{ reused: true }, { reused: true }] })).to.equal(0)
		expect(f({ _cached: "no" })).to.equal(0)
	})
})

describe("transcript presenter: honest lifting and header (N3 to N9)", () => {
	it("keeps lifted-line keys distinct when two messages share a ts", () => {
		const a = { ts: 5, type: "say", say: "api_req_retried", text: "a" } as AiHydroMessage
		const b = { ts: 5, type: "say", say: "api_req_retried", text: "b" } as AiHydroMessage
		const g = groups(presentTranscript([a, b], { detail: "normal" }))[0]
		expect(g.lifted).to.have.length(2)
		expect(new Set(g.lifted.map((l) => l.key)).size).to.equal(2)
	})
	it("lifts an undecided approval ask and excludes it from toolCount and waitingMs", () => {
		reset()
		const g = groups(
			present([
				say("task", "x"),
				say("command", "ok", { execOutcome: "completed", exitCode: 0 }),
				req(),
				ask("command", "rm -rf x"),
				req(),
				say("text", "moving on"),
			]),
		)[0]
		expect(g.lifted.map((l) => l.reason)).to.deep.equal(["no_decision"])
		expect(g.facts.toolCount).to.equal(1)
		expect(g.facts.notRunCount).to.equal(1)
		expect(g.facts.waitingMs).to.equal(0)
	})
	it("does not count a denied call as a tool run", () => {
		reset()
		const g = groups(
			present([say("task", "x"), req(), ask("command", "a", { askOutcome: "denied" }), say("user_feedback", "no")]),
		)[0]
		expect(g.facts.toolCount).to.equal(0)
		expect(g.facts.notRunCount).to.equal(1)
	})
	it("lifts an unknown cancelReason", () => {
		reset()
		expect(lifted([req({ cancelReason: "aborted" })], SAFE).map((l) => l.reason)).to.deep.equal(["request_failed"])
	})
	it("labels a zero cost 'no cost recorded', not unavailable", () => {
		reset()
		const f = (rows: Array<Record<string, unknown>>) =>
			groups(present([say("task", "x"), ...rows.map((r) => req(r))]))[0].facts.cost
		expect(f([{ cost: 0 }])).to.include({ status: "unrecorded", label: "no cost recorded" })
		expect(f([{ costStatus: "unavailable" }]).status).to.equal("unavailable")
	})
})

describe("transcript presenter: every failure-shaped or security-marked member is lifted (N11 property)", () => {
	const members: Array<[string, () => AiHydroMessage[], Partial<Parameters<typeof presentTranscript>[1]>?]> = [
		["nonzero exit", () => [say("command", "x", { exitCode: 1 })]],
		["unknown exit", () => [say("command", "x", { exitCode: "unknown" })]],
		["failed tool outcome", () => [say("tool", JSON.stringify({ tool: "readFile", path: "a" }), { execOutcome: "failed" })]],
		["denied ask", () => [ask("tool", JSON.stringify({ tool: "readFile" }), { askOutcome: "denied" }), req()]],
		[
			"undecided ask (recorded era)",
			() => [say("command", "ok", { execOutcome: "completed", exitCode: 0 }), ask("command", "x"), req()],
		],
		["policy command", () => [say("command", "x", { policyClass: "auto_run_all", exitCode: 0 })]],
		["outside workspace", () => [ask("tool", "{}", { isOperationOutsideWorkspace: true, askOutcome: "approved" }), req()]],
		["approved mcp, no resolver", () => [ask("use_mcp_server", "{}", { askOutcome: "approved" }), mcpResp({})]],
		["auto-run write, no resolver", () => [say("tool", JSON.stringify({ tool: "newFileCreated", path: "a", content: "x" }))]],
		["failed mcp result", () => [mcpCall(), mcpResp({ status: "failed" })], SAFE],
		["cancelled request", () => [req({ cancelReason: "user_cancelled" })]],
		["elevated notification", () => [say("mcp_notification", "x", { mcpLevel: "error" })]],
	]
	for (const [name, build, opts] of members) {
		it(name, () => {
			reset()
			const rows = build()
			const items = presentTranscript([say("task", "x"), req(), ...rows], { detail: "normal", ...(opts ?? {}) })
			const ls = groups(items).flatMap((g) => g.lifted)
			// the member that carries the evidence: the last non-request row of the built list
			const evidence = rows.filter((r) => r.say !== "api_req_started" || name === "cancelled request")
			const sources = new Set(ls.map((l) => l.sourceTs))
			expect(
				evidence.some((r) => sources.has(r.ts)),
				name,
			).to.equal(true)
		})
	}
})

describe("transcript presenter: final round (resolver throw, write detection, legacy, large results)", () => {
	it("treats a throwing resolver as UNKNOWN: the call lifts and nothing crashes", () => {
		reset()
		const boom = () => {
			throw new Error("resolver failed")
		}
		const mcp = ask("use_mcp_server", JSON.stringify({ serverName: "s", toolName: "t" }), { askOutcome: "approved" })
		expect(lifted([mcp, mcpResp({})], { effectClassFor: boom, isProtectedPath: boom }).map((l) => l.reason)).to.deep.equal([
			"approved_security",
		])
		reset()
		const edit = ask("tool", JSON.stringify({ tool: "readFile", path: "a.txt" }), { askOutcome: "approved" })
		expect(lifted([edit, req()], { isProtectedPath: boom }).map((l) => l.reason)).to.deep.equal(["approved_security"])
	})
	const approvedPath = (o: Record<string, unknown>) => ask("tool", JSON.stringify(o), { askOutcome: "approved" })
	for (const o of [
		{ tool: "appendToFile", path: "a.txt" },
		{ tool: "insertLines", path: "a.txt" },
		{ tool: "saveFile", path: "a.txt" },
		{ tool: "truncateFile", path: "a.txt" },
		{ tool: "copyFile", path: "a.txt" },
		{ tool: "touch", path: "a.txt" },
		{ tool: "somethingNew", filePath: "a.txt" },
		{ tool: "editedExistingFile", filePath: ".env" },
	]) {
		it(`lifts ${JSON.stringify(o)} when no path resolver is given`, () => {
			reset()
			expect(lifted([approvedPath(o), req()]).map((l) => l.reason)).to.deep.equal(["approved_security"])
		})
	}
	for (const tool of [
		"readFile",
		"listFilesTopLevel",
		"listFilesRecursive",
		"listCodeDefinitionNames",
		"searchFiles",
		"webFetch",
	]) {
		it(`does not lift read-only ${tool}`, () => {
			reset()
			expect(lifted([approvedPath({ tool, path: "a" }), req()])).to.have.length(0)
		})
	}
	it("reads filePath through a path resolver too", () => {
		reset()
		const out = lifted([approvedPath({ tool: "readFile", filePath: ".env" }), req()], {
			isProtectedPath: (p) => p === ".env",
		})
		expect(out).to.have.length(1)
	})
	it("keeps legacy tasks (no recorded outcomes) neutral: undecided asks count as calls, nothing lifted", () => {
		reset()
		const g = groups(
			presentTranscript([say("task", "x"), req(), ask("command", "ls"), req(), ask("command", "pwd"), req()], {
				detail: "normal",
				...SAFE,
			}),
		)[0]
		expect(g.lifted).to.have.length(0)
		expect(g.facts.toolCount).to.equal(2)
		expect(g.facts.notRunCount).to.equal(0)
	})
	it("does not lift large benign results, but still finds a failure after many object nodes", () => {
		reset()
		const polygon = { type: "Polygon", coordinates: [Array.from({ length: 25_000 }, (_, i) => [i, i / 2])] }
		expect(lifted([mcpCall(), mcpResp(polygon)], SAFE)).to.have.length(0)
		reset()
		const table = { columns: ["a", "b", "c"], rows: Array.from({ length: 25_000 }, (_, i) => [i, i + 1, i + 2]) }
		expect(lifted([mcpCall(), mcpResp(table)], SAFE)).to.have.length(0)
		reset()
		const objs = Array.from({ length: 30_000 }, (_, i) => ({ i }))
		expect(lifted([mcpCall(), mcpResp({ items: [...objs, { status: "failed" }] })], SAFE).map((l) => l.reason)).to.deep.equal(
			["mcp_error"],
		)
		reset()
		const huge = Array.from({ length: 120_000 }, (_, i) => ({ i }))
		expect(lifted([mcpCall(), mcpResp({ items: [...huge, { status: "failed" }] })], SAFE).map((l) => l.reason)).to.deep.equal(
			["result_uninspected"],
		)
	})
	it("still finds blocking inside an array of objects mixed with numbers", () => {
		reset()
		expect(lifted([mcpCall(), mcpResp({ a: [1, 2, { blocking: true }] })], SAFE).map((l) => l.reason)).to.deep.equal([
			"blocking",
		])
	})
})

describe("transcript presenter: pending answer_audit rows (W2-C)", () => {
	it("are invisible: no item, no revision, no lifted line, and they do not split a group", () => {
		reset()
		const pending = say(
			"answer_audit",
			JSON.stringify({ stage: "pending", status: "pending", answerTs: 1, draftHash: "h", draft: "UNCHECKED DRAFT TEXT" }),
		)
		const items = present([req(), mcpCall(), mcpResp({ ok: true }), pending, req(), mcpCall(), mcpResp({ ok: true })])
		expect(items.map((i) => i.kind)).to.deep.equal(["group"])
		const g = groups(items)[0]
		expect(g.facts.revisionCount).to.equal(0)
		expect(g.lifted).to.have.length(0)
		expect(g.facts.toolCount).to.equal(2)
		expect(JSON.stringify(items)).to.not.include("UNCHECKED DRAFT TEXT")
	})
})

describe("transcript presenter: W2-A2 review fixes", () => {
	it("a host-stamped protected_path approval lifts even when the webview matcher says the path is fine", () => {
		reset()
		const stamped = ask("tool", JSON.stringify({ tool: "editedExistingFile", path: "id", diff: "x" }), {
			askOutcome: "approved",
			policyClass: "protected_path",
		})
		const items = presentTranscript([stamped, req()], { detail: "normal", ...SAFE })
		const g = groups(items)[0]
		expect(g.lifted.map((l) => l.reason)).to.deep.equal(["policy_command"])
		expect(g.lifted[0].text).to.include("protected path")
	})

	it("an interrupted audit row is a divider but not a revision; a revision row is", () => {
		const audit = (stage: string) =>
			JSON.stringify({
				v: 1,
				stage,
				status: "unavailable",
				hardCount: 0,
				advisoryCount: 0,
				schema: "legacy",
				attempt: 1,
				answerTs: 1,
				draftHash: "h",
				violations: [],
			})
		reset()
		const run = (stage: string) => {
			reset()
			return presentTranscript([req(), mcpCall(), mcpResp({ ok: true }), say("answer_audit", audit(stage))], {
				detail: "normal",
				...SAFE,
			})
		}
		const interrupted = run("interrupted")
		expect(interrupted.map((i) => i.kind)).to.deep.equal(["group", "divider"])
		expect(groups(interrupted)[0].facts.revisionCount).to.equal(0)
		expect(groups(run("revision"))[0].facts.revisionCount).to.equal(1)
	})
})
