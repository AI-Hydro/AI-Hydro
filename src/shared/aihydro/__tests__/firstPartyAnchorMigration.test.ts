import { expect } from "chai"
import { describe, it } from "mocha"
import {
	explainServerTrust,
	type FirstPartyLauncher,
	isServerTrusted,
	launchContextHash,
	planFirstPartyAnchor,
	type SettingsServerEntry,
	sha256Hex,
} from "../firstPartyServers"

const RECORDED: FirstPartyLauncher = { name: "ai-hydro", command: "/opt/miniconda3/bin/aihydro-mcp", args: [] }
const entry = (
	name: string,
	command: string,
	args: string[] = [],
	extra: Partial<SettingsServerEntry> = {},
): SettingsServerEntry => ({
	name,
	type: "stdio",
	command,
	args,
	...extra,
})
const conn = (name: string, command: string, args: string[] = []) => ({
	name,
	config: JSON.stringify({ type: "stdio", command, args }),
})

describe("planFirstPartyAnchor (S6 safe migration)", () => {
	it("study case: recorded server disabled, one enabled first-party-shaped server with the SAME launch line -> silent rename", () => {
		const plan = planFirstPartyAnchor(
			[entry("ai-hydro", RECORDED.command, [], { disabled: true }), entry("aihydro-tools", RECORDED.command)],
			RECORDED,
		)
		expect(plan.action).to.equal("rename")
		expect((plan as any).candidate.name).to.equal("aihydro-tools")
	})

	it("a different (but first-party-shaped) launch line needs the human: confirm, never silent", () => {
		const plan = planFirstPartyAnchor(
			[
				entry("ai-hydro", RECORDED.command, [], { disabled: true }),
				entry("aihydro-tools", "python3", ["-m", "ai_hydro.mcp"]),
			],
			RECORDED,
		)
		expect(plan.action).to.equal("confirm")
	})

	it("with no record at all it still asks (never records silently)", () => {
		expect(planFirstPartyAnchor([entry("aihydro-tools", "aihydro-mcp")], undefined).action).to.equal("confirm")
	})

	it("does nothing when the recorded server is enabled (the existing reconcile owns that case)", () => {
		const plan = planFirstPartyAnchor(
			[entry("ai-hydro", RECORDED.command), entry("aihydro-tools", RECORDED.command)],
			RECORDED,
		)
		expect(plan.action).to.equal("none")
	})

	it("adversarial: a look-alike with the wrong command/args/type/name never becomes a candidate", () => {
		const disabledRecorded = entry("ai-hydro", RECORDED.command, [], { disabled: true })
		const lookalikes: SettingsServerEntry[][] = [
			[entry("aihydro-tools", "/tmp/evil-mcp")], // not the launcher shape
			[entry("aihydro-tools", "python3", ["-m", "evil"])],
			[entry("aihydro-tools", "aihydro-mcp", ["--evil"])],
			[entry("aihydro-tools", "python3", ["-m", "ai_hydro.mcp", "--x"])],
			[{ name: "aihydro-tools", type: "sse", command: "aihydro-mcp", args: [] }], // remote
			[entry("my-aihydro-fork", "aihydro-mcp")], // right shape, not a first-party NAME
			[entry("aihydro-evil-fork", "aihydro-mcp")],
			[entry("aihydro-tools", "aihydro-mcp", [], { disabled: true })], // disabled
			[{ name: "aihydro-tools", type: "stdio", command: ["aihydro-mcp"] as any, args: [] }], // non-string command
			[{ name: "aihydro-tools", type: "stdio", command: "aihydro-mcp", args: "x" as any }],
			[entry("AI-Hydro-evil", "aihydro-mcp")],
		]
		for (const others of lookalikes) {
			const plan = planFirstPartyAnchor([disabledRecorded, ...others], RECORDED)
			expect(plan.action, JSON.stringify(others)).to.equal("none")
		}
	})

	it("adversarial: two eligible servers are ambiguous and nothing is chosen", () => {
		const plan = planFirstPartyAnchor(
			[
				entry("ai-hydro", RECORDED.command, [], { disabled: true }),
				entry("aihydro-tools", RECORDED.command),
				entry("aihydro", RECORDED.command),
			],
			RECORDED,
		)
		expect(plan.action).to.equal("ambiguous")
		expect((plan as any).candidates).to.have.members(["aihydro-tools", "aihydro"])
	})

	it("a shape-matching binary in an attacker directory under the same name still needs confirmation, not a silent rename", () => {
		const plan = planFirstPartyAnchor(
			[entry("ai-hydro", RECORDED.command, [], { disabled: true }), entry("aihydro-tools", "/tmp/x/aihydro-mcp")],
			RECORDED,
		)
		expect(plan.action).to.equal("confirm")
	})
})

describe("explainServerTrust (UI trust state)", () => {
	it("agrees with isServerTrusted for every case and names the reason", () => {
		const cases: Array<[any, FirstPartyLauncher | undefined]> = [
			[conn("ai-hydro", RECORDED.command), RECORDED],
			[conn("aihydro-tools", RECORDED.command), RECORDED],
			[conn("ai-hydro", "/tmp/evil"), RECORDED],
			[conn("ai-hydro", RECORDED.command), undefined],
			[conn("other", "x"), RECORDED],
			[{ name: "ai-hydro", config: "{bad" }, RECORDED],
			[{ name: "ai-hydro", config: JSON.stringify({ type: "sse", url: "https://x" }) }, RECORDED],
		]
		for (const [server, launcher] of cases) {
			const explained = explainServerTrust(server, launcher)
			expect(explained.trusted, JSON.stringify(server)).to.equal(isServerTrusted(server, launcher))
			expect(explained.reason.length).to.be.greaterThan(10)
		}
	})

	it("the study case explains the name mismatch and points to the safe path, without trusting it", () => {
		const e = explainServerTrust(conn("aihydro-tools", "python3", ["-m", "ai_hydro.mcp"]), RECORDED)
		expect(e.trusted).to.equal(false)
		expect(e.reason).to.include("running from a new location")
		expect(e.reason).to.include("until you confirm it")
		expect(e.reason).to.not.match(/restart/i)
	})

	it("trusted servers say why", () => {
		const e = explainServerTrust(conn("ai-hydro", RECORDED.command), RECORDED)
		expect(e).to.deep.include({ trusted: true })
		expect(e.reason).to.match(/^Trusted:/)
	})
})

describe("launch context identity (env, cwd) in first-party trust", () => {
	const withCtx = (name: string, command: string, extra: Record<string, unknown>) => ({
		name,
		config: JSON.stringify({ type: "stdio", command, args: [], ...extra }),
	})
	const CTX = { env: { TMPDIR: "/c", TMP: "/c" }, cwd: "/c" }
	const rec: FirstPartyLauncher = { ...RECORDED, launchHash: launchContextHash(CTX) }

	it("is trusted only when env AND cwd match the recorded context (key order irrelevant)", () => {
		expect(isServerTrusted(withCtx("ai-hydro", RECORDED.command, CTX), rec)).to.equal(true)
		expect(
			isServerTrusted(withCtx("ai-hydro", RECORDED.command, { env: { TMP: "/c", TMPDIR: "/c" }, cwd: "/c" }), rec),
		).to.equal(true)
	})

	it("adversarial: PYTHONPATH injection, a different cwd, and a different PATH under a bare command are not trusted", () => {
		const bare: FirstPartyLauncher = {
			name: "ai-hydro",
			command: "aihydro-mcp",
			args: [],
			launchHash: launchContextHash(CTX),
		}
		for (const extra of [
			{ ...CTX, env: { ...CTX.env, PYTHONPATH: "/attacker" } },
			{ ...CTX, cwd: "/attacker" },
			{ ...CTX, env: { ...CTX.env, PATH: "/attacker/bin" } },
			{ cwd: "/c" }, // env dropped
			{ env: CTX.env }, // cwd dropped
			{ ...CTX, env: "x" },
		]) {
			expect(isServerTrusted(withCtx("ai-hydro", "aihydro-mcp", extra), bare), JSON.stringify(extra)).to.equal(false)
		}
		const e = explainServerTrust(
			withCtx("ai-hydro", RECORDED.command, { ...CTX, env: { ...CTX.env, PYTHONPATH: "/a" } }),
			rec,
		)
		expect(e.trusted).to.equal(false)
		expect(e.reason).to.include("environment")
	})

	it("a legacy record (no hash) reads as the empty context: an entry with env/cwd is NOT trusted until confirmed", () => {
		expect(isServerTrusted(withCtx("ai-hydro", RECORDED.command, {}), RECORDED)).to.equal(true)
		expect(isServerTrusted(withCtx("ai-hydro", RECORDED.command, CTX), RECORDED)).to.equal(false)
	})

	it("migration: same command/args but different env or cwd -> confirm, never a silent rename", () => {
		const disabled = entry("ai-hydro", RECORDED.command, [], { disabled: true })
		for (const extra of [{ env: { PYTHONPATH: "/attacker" } }, { cwd: "/attacker" }, { env: { PATH: "/attacker/bin" } }]) {
			const plan = planFirstPartyAnchor([disabled, entry("aihydro-tools", RECORDED.command, [], extra as any)], RECORDED)
			expect(plan.action, JSON.stringify(extra)).to.equal("confirm")
		}
		// identical context to a hashed record still renames silently
		const hashed: FirstPartyLauncher = { ...RECORDED, launchHash: launchContextHash(CTX) }
		expect(
			planFirstPartyAnchor([disabled, entry("aihydro-tools", RECORDED.command, [], CTX as any)], hashed).action,
		).to.equal("rename")
		// legacy record + entry carrying env: confirm
		expect(
			planFirstPartyAnchor([disabled, entry("aihydro-tools", RECORDED.command, [], CTX as any)], RECORDED).action,
		).to.equal("confirm")
	})

	it("a non-boolean `disabled` is invalid under the settings schema: neither enabled nor a candidate", () => {
		const recorded = entry("ai-hydro", RECORDED.command, [], { disabled: "true" as any })
		expect(planFirstPartyAnchor([recorded, entry("aihydro-tools", RECORDED.command)], RECORDED).action).to.equal("rename")
		const plan = planFirstPartyAnchor(
			[
				entry("ai-hydro", RECORDED.command, [], { disabled: true }),
				entry("aihydro-tools", RECORDED.command, [], { disabled: "no" as any }),
			],
			RECORDED,
		)
		expect(plan.action).to.equal("none")
	})

	it("sha256 matches the known vector", () => {
		expect(sha256Hex("abc")).to.equal("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
		expect(sha256Hex("")).to.equal("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
	})
})
