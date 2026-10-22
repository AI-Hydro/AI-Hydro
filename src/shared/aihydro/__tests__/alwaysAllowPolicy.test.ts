import { expect } from "chai"
import { describe, it } from "mocha"
import {
	type AlwaysAllowRefusalReason,
	AUTO_APPROVE_REFUSED_PREFIX,
	alwaysAllowReasonText,
	alwaysAllowVerdict,
	describeAutoApproveRefusal,
	formatAutoApproveRefusal,
	parseAutoApproveRefusal,
} from "../alwaysAllowPolicy"

const READ = { name: "r", annotations: { readOnlyHint: true, openWorldHint: false } }
const WRITE = { name: "w", annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } }
const NET = { name: "n", annotations: { readOnlyHint: true } }
const NUKE = { name: "d", annotations: { destructiveHint: true } }
const BARE = { name: "b" }
const tools = [READ, WRITE, NET, NUKE, BARE]
const base = { serverTrusted: true, serverConnected: true, tools }

describe("alwaysAllowVerdict", () => {
	it("accepts READ, WRITE and NETWORK tools on a trusted connected server", () => {
		for (const t of [READ, WRITE, NET]) {
			expect(alwaysAllowVerdict({ ...base, toolName: t.name }), t.name).to.deep.equal({ ok: true })
		}
	})

	it("untrusted_server: annotations are never read", () => {
		for (const t of [READ, WRITE, NET, NUKE, BARE]) {
			expect(alwaysAllowVerdict({ ...base, serverTrusted: false, toolName: t.name })).to.deep.equal({
				ok: false,
				reason: "untrusted_server",
			})
		}
		// Even for a name the server does not list.
		expect(alwaysAllowVerdict({ ...base, serverTrusted: false, toolName: "zzz" })).to.deep.equal({
			ok: false,
			reason: "untrusted_server",
		})
	})

	it("server_unavailable: trusted but not connected", () => {
		expect(alwaysAllowVerdict({ ...base, serverConnected: false, toolName: "r" })).to.deep.equal({
			ok: false,
			reason: "server_unavailable",
		})
	})

	it("unknown_tool: unlisted, no tool list, wrong case, or listed twice", () => {
		expect(alwaysAllowVerdict({ ...base, toolName: "zzz" })).to.deep.equal({ ok: false, reason: "unknown_tool" })
		expect(alwaysAllowVerdict({ ...base, tools: undefined, toolName: "r" })).to.deep.equal({
			ok: false,
			reason: "unknown_tool",
		})
		expect(alwaysAllowVerdict({ ...base, toolName: "R" })).to.deep.equal({ ok: false, reason: "unknown_tool" })
		expect(alwaysAllowVerdict({ ...base, tools: [READ, READ], toolName: "r" })).to.deep.equal({
			ok: false,
			reason: "unknown_tool",
		})
		// A duplicate whose second copy is destructive cannot borrow the first copy's READ.
		expect(
			alwaysAllowVerdict({ ...base, tools: [READ, { name: "r", annotations: { destructiveHint: true } }], toolName: "r" }),
		).to.deep.equal({ ok: false, reason: "unknown_tool" })
	})

	it("destructive and unknown_effect", () => {
		expect(alwaysAllowVerdict({ ...base, toolName: "d" })).to.deep.equal({ ok: false, reason: "destructive" })
		expect(alwaysAllowVerdict({ ...base, toolName: "b" })).to.deep.equal({ ok: false, reason: "unknown_effect" })
		// Non-boolean hints take the conservative spec default.
		const stringy = { name: "s", annotations: { readOnlyHint: "true" as unknown, openWorldHint: false } }
		expect(alwaysAllowVerdict({ ...base, tools: [stringy], toolName: "s" })).to.deep.equal({
			ok: false,
			reason: "destructive",
		})
	})

	it("every reason has user-facing text, and the untrusted text names the trust requirement", () => {
		const reasons: AlwaysAllowRefusalReason[] = [
			"untrusted_server",
			"server_unavailable",
			"unknown_tool",
			"destructive",
			"unknown_effect",
		]
		for (const r of reasons) {
			expect(alwaysAllowReasonText(r).length).to.be.greaterThan(10)
		}
		expect(alwaysAllowReasonText("untrusted_server")).to.match(/not the registered first-party server/)
	})
})

describe("auto-approve refusal wire format", () => {
	const refusal = { server: "s", refused: [{ tool: "t", reason: "destructive" as const }] }

	it("round-trips and tolerates a wrapper prefix", () => {
		const msg = formatAutoApproveRefusal(refusal)
		expect(msg.startsWith(AUTO_APPROVE_REFUSED_PREFIX)).to.equal(true)
		expect(parseAutoApproveRefusal(msg)).to.deep.equal(refusal)
		expect(parseAutoApproveRefusal(`Error: ${msg}`)).to.deep.equal(refusal)
	})

	it("rejects malformed or forged payloads", () => {
		expect(parseAutoApproveRefusal(AUTO_APPROVE_REFUSED_PREFIX + "{")).to.equal(undefined)
		expect(parseAutoApproveRefusal(AUTO_APPROVE_REFUSED_PREFIX + JSON.stringify({ server: "s", refused: [] }))).to.equal(
			undefined,
		)
		expect(
			parseAutoApproveRefusal(
				AUTO_APPROVE_REFUSED_PREFIX + JSON.stringify({ server: "s", refused: [{ tool: "t", reason: "nope" }] }),
			),
		).to.equal(undefined)
	})

	it("describes the first refusal and the count of the rest", () => {
		const text = describeAutoApproveRefusal({
			server: "s",
			refused: [
				{ tool: "a", reason: "destructive" },
				{ tool: "b", reason: "unknown_effect" },
			],
		})
		expect(text).to.include("a (and 1 more)")
		expect(text).to.include("Nothing was changed")
	})
})
