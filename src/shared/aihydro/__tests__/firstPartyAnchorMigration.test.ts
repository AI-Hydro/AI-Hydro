import { expect } from "chai"
import { describe, it } from "mocha"
import {
	explainServerTrust,
	type FirstPartyLauncher,
	isServerTrusted,
	planFirstPartyAnchor,
	type SettingsServerEntry,
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
		expect(e.reason).to.include("'ai-hydro'")
		expect(e.reason).to.include("restart")
	})

	it("trusted servers say why", () => {
		const e = explainServerTrust(conn("ai-hydro", RECORDED.command), RECORDED)
		expect(e).to.deep.include({ trusted: true })
		expect(e.reason).to.match(/^Trusted:/)
	})
})
