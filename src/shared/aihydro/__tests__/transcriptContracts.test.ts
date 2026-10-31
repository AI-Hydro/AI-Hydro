import { expect } from "chai"
import { describe, it } from "mocha"
import {
	ANSWER_AUDIT_PAYLOAD_VERSION,
	type AnswerAuditPayload,
	classifyLegacyInfoNotice,
	countFindings,
	isCleanAudit,
	isLiftedNotice,
	parseAnswerAuditPayload,
} from "../transcriptContracts"

const payload = (over: Partial<AnswerAuditPayload> = {}): AnswerAuditPayload => ({
	v: ANSWER_AUDIT_PAYLOAD_VERSION,
	stage: "final",
	status: "violations",
	hardCount: 1,
	advisoryCount: 1,
	violations: [
		{ kind: "untraced_number", severity: "hard", excerpt: "0.42" },
		{ kind: "stale", severity: "advisory" },
	],
	schema: "graded",
	attempt: 0,
	answerTs: 100,
	draftHash: "abc",
	...over,
})

describe("legacy info notice registry", () => {
	const cases: Array<[string, string, string]> = [
		["malformed tool call; retried\n\n<tool_calls>x</tool_calls>", "malformed_tool_call", "warning"],
		["Native tool call not at end of message; not run.\n\nrest", "native_call_not_run", "warning"],
		["Repaired a native tool call: use_mcp_tool.", "native_call_repaired", "info"],
		["Skipped: 'nope' is not a tool on 'ai-hydro'. Asked the model to retry.", "unknown_tool", "warning"],
	]
	for (const [text, cls, severity] of cases) {
		it(`maps ${cls}`, () => {
			expect(classifyLegacyInfoNotice(text)).to.deep.equal({ class: cls, severity })
		})
	}

	it("lifts unmatched text and other Skipped: lines as unclassified", () => {
		for (const text of ["", undefined, "something new", "Skipped: 'x' for another reason"]) {
			const n = classifyLegacyInfoNotice(text)
			expect(n.class).to.equal("unclassified")
			expect(isLiftedNotice(n)).to.equal(true)
		}
	})

	it("only info-severity known classes fold", () => {
		expect(isLiftedNotice({ class: "native_call_repaired", severity: "info" })).to.equal(false)
		expect(isLiftedNotice({ class: "context_truncated", severity: "warning" })).to.equal(true)
	})

	it("trusts the class over a stored severity", () => {
		expect(isLiftedNotice({ class: "context_truncated", severity: "info" })).to.equal(true)
		expect(isLiftedNotice({ class: "malformed_tool_call", severity: "" })).to.equal(true)
		expect(isLiftedNotice({ class: "future_class", severity: "info" })).to.equal(true)
		expect(isLiftedNotice({ class: "native_call_repaired", severity: "warning" })).to.equal(false)
	})
})

describe("answer audit payload", () => {
	it("round-trips a v1 payload", () => {
		const p = payload()
		expect(parseAnswerAuditPayload(JSON.stringify(p))).to.deep.equal(p)
	})

	it("keeps a known gateSkipped reason and drops an unknown one", () => {
		expect(parseAnswerAuditPayload(JSON.stringify({ ...payload(), gateSkipped: "no-trusted-server" }))?.gateSkipped).to.equal(
			"no-trusted-server",
		)
		expect(parseAnswerAuditPayload(JSON.stringify({ ...payload(), gateSkipped: "made-up" }))?.gateSkipped).to.equal(undefined)
	})

	it("ignores other versions and garbage", () => {
		expect(parseAnswerAuditPayload(JSON.stringify({ ...payload(), v: 2 }))).to.equal(undefined)
		expect(parseAnswerAuditPayload("not json")).to.equal(undefined)
		expect(parseAnswerAuditPayload(undefined)).to.equal(undefined)
	})

	it("recomputes counts from the violation list", () => {
		const parsed = parseAnswerAuditPayload(JSON.stringify(payload({ hardCount: 0, advisoryCount: 0 })))
		expect(parsed?.hardCount).to.equal(1)
		expect(parsed?.advisoryCount).to.equal(1)
	})

	it("treats a missing or invalid severity as unknown and a missing schema as legacy", () => {
		const raw = { ...payload(), schema: undefined, violations: [{ kind: "k" }, { kind: "k2", severity: "bogus" }] }
		const parsed = parseAnswerAuditPayload(JSON.stringify(raw))
		expect(parsed?.schema).to.equal("legacy")
		expect(parsed?.violations.map((v) => v.severity)).to.deep.equal(["unknown", "unknown"])
		expect(countFindings(parsed!.violations)).to.deep.equal({ hardCount: 0, advisoryCount: 0, unknownCount: 2 })
	})

	it("only a finding-free, undisclosed pass is clean", () => {
		expect(isCleanAudit(payload({ status: "passed", violations: [] }))).to.equal(true)
		expect(isCleanAudit(payload({ status: "passed" }))).to.equal(false)
		expect(isCleanAudit(payload({ status: "unavailable", violations: [] }))).to.equal(false)
		expect(isCleanAudit(payload({ status: "passed", violations: [], disclosure: { kind: "interrupted" } }))).to.equal(false)
	})
})
