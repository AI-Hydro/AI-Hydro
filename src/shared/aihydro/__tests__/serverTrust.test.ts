import { expect } from "chai"
import { describe, it } from "mocha"
import { parseApprovalRequired } from "../claimApproval"
import {
	canOfferTrustAction,
	describeStaleAnchor,
	explainServerTrust,
	type FirstPartyLauncher,
	firstPartyCandidates,
	isServerTrusted,
	looksLikeFirstPartyLauncher,
	staleAnchorNote,
} from "../firstPartyServers"
import { effectClass } from "../mcpEffectClass"

const LAUNCHER: FirstPartyLauncher = { name: "ai-hydro", command: "/opt/miniconda3/bin/aihydro-mcp", args: [] }
const PY_LAUNCHER: FirstPartyLauncher = { name: "ai-hydro", command: "python3", args: ["-m", "ai_hydro.mcp"] }

const server = (name: string, config: Record<string, unknown>) => ({ name, config: JSON.stringify(config) })
const stdio = (command: string, args: string[] = []) => ({ type: "stdio", command, args })

describe("isServerTrusted (B4: name AND recorded launcher)", () => {
	it("trusts the registered launcher under the registered name", () => {
		expect(isServerTrusted(server("ai-hydro", stdio(LAUNCHER.command)), LAUNCHER)).to.equal(true)
		expect(isServerTrusted(server("ai-hydro", stdio("python3", ["-m", "ai_hydro.mcp"])), PY_LAUNCHER)).to.equal(true)
	})

	it("treats missing args as an empty list", () => {
		expect(isServerTrusted(server("ai-hydro", { type: "stdio", command: LAUNCHER.command }), LAUNCHER)).to.equal(true)
	})

	it("T3 a stdio server named aihydro with a non-launcher command is not trusted", () => {
		const hostile = { ...LAUNCHER, name: "aihydro" }
		expect(isServerTrusted(server("aihydro", stdio("/tmp/evil-mcp")), hostile)).to.equal(false)
		expect(isServerTrusted(server("ai-hydro", stdio("/tmp/evil-mcp")), LAUNCHER)).to.equal(false)
		expect(isServerTrusted(server("ai-hydro", stdio(LAUNCHER.command, ["--evil"])), LAUNCHER)).to.equal(false)
		expect(isServerTrusted(server("ai-hydro", stdio("python3", ["-m", "evil"])), PY_LAUNCHER)).to.equal(false)
	})

	it("T4 a remote server named ai-hydro is not trusted", () => {
		expect(isServerTrusted(server("ai-hydro", { type: "sse", url: "https://example.com/mcp" }), LAUNCHER)).to.equal(false)
		expect(
			isServerTrusted(server("ai-hydro", { type: "streamableHttp", url: "https://example.com/mcp" }), LAUNCHER),
		).to.equal(false)
		// Even one that also carries the launcher's command fields.
		expect(
			isServerTrusted(server("ai-hydro", { type: "sse", url: "https://x", command: LAUNCHER.command }), LAUNCHER),
		).to.equal(false)
	})

	it("T5 trust comes from the resolved connection, so a case-mismatched or unresolved name is not trusted", () => {
		expect(isServerTrusted(server("AI-Hydro", stdio(LAUNCHER.command)), LAUNCHER)).to.equal(false)
		expect(isServerTrusted(server(" ai-hydro", stdio(LAUNCHER.command)), LAUNCHER)).to.equal(false)
		expect(isServerTrusted(undefined, LAUNCHER)).to.equal(false)
	})

	it("is fail-closed: no record, malformed config, or a name outside the first-party set is not trusted", () => {
		expect(isServerTrusted(server("ai-hydro", stdio(LAUNCHER.command)), undefined)).to.equal(false)
		expect(isServerTrusted({ name: "ai-hydro", config: "{not json" }, LAUNCHER)).to.equal(false)
		expect(isServerTrusted({ name: "ai-hydro" }, LAUNCHER)).to.equal(false)
		expect(isServerTrusted(server("my-server", stdio("x")), { name: "my-server", command: "x", args: [] })).to.equal(false)
	})

	it("recognises first-party launcher shapes only for registration", () => {
		expect(looksLikeFirstPartyLauncher("/opt/miniconda3/bin/aihydro-mcp", [])).to.equal(true)
		expect(looksLikeFirstPartyLauncher("C:\\Python312\\Scripts\\aihydro-mcp.exe", [])).to.equal(true)
		expect(looksLikeFirstPartyLauncher("python3", ["-m", "ai_hydro.mcp"])).to.equal(true)
		expect(looksLikeFirstPartyLauncher("python3", ["-c", "evil"])).to.equal(false)
		expect(looksLikeFirstPartyLauncher("aihydro-mcp", ["--extra"])).to.equal(false)
		expect(looksLikeFirstPartyLauncher("/tmp/evil", [])).to.equal(false)
	})

	it("claim-approval prompts use the same single trust test", () => {
		const refusal = JSON.stringify({ error: true, code: "APPROVAL_REQUIRED", session_id: "s", claim_id: "c" })
		const trusted = server("ai-hydro", stdio(LAUNCHER.command))
		// parseApprovalRequired reads the module-level record; with none installed nothing is trusted.
		expect(parseApprovalRequired(refusal, trusted)).to.equal(undefined)
	})
})

describe("effectClass (T1)", () => {
	it("T1 follows the spec defaults; only readOnlyHint:true is NETWORK", () => {
		expect(effectClass(undefined)).to.equal("UNKNOWN")
		expect(effectClass({})).to.equal("DESTRUCTIVE") // spec defaults: not read-only, destructive
		expect(effectClass({ readOnlyHint: true })).to.equal("NETWORK") // open-world by default
		expect(effectClass({ readOnlyHint: true, openWorldHint: false })).to.equal("READ")
		expect(effectClass({ readOnlyHint: false, destructiveHint: false, openWorldHint: false })).to.equal("WRITE")
		expect(effectClass({ readOnlyHint: false, destructiveHint: false, openWorldHint: true })).to.equal("NETWORK")
		expect(effectClass({ readOnlyHint: false, destructiveHint: true, openWorldHint: false })).to.equal("DESTRUCTIVE")
		expect(effectClass({ readOnlyHint: false, destructiveHint: true, openWorldHint: true })).to.equal("DESTRUCTIVE")
	})

	it("treats non-boolean hints as absent", () => {
		expect(effectClass({ readOnlyHint: "true", openWorldHint: false })).to.equal("DESTRUCTIVE")
		expect(effectClass({ readOnlyHint: true, openWorldHint: "false" })).to.equal("NETWORK")
	})
})

describe("trust wording and the stale first-party record (Trust UX)", () => {
	const OLD = { name: "ai-hydro", command: "/opt/miniconda3/bin/aihydro-mcp", args: [] as string[] }
	const NEW_CMD = "/Users/x/.aihydro/venvs/tools-2.8/bin/aihydro-mcp"

	it("a new launch line is explained in plain words with the exact command, and names the action", () => {
		const v = explainServerTrust({ name: "ai-hydro", config: JSON.stringify(stdio(NEW_CMD)) }, OLD)
		expect(v.trusted).to.equal(false)
		expect(v.reason).to.contain(`AI-Hydro Tools is running from a new location (\`${NEW_CMD}\`)`)
		expect(v.reason).to.contain("Your auto-run settings are paused until you confirm it.")
		expect(v.reason).to.not.match(/launch identity|Restart AI-Hydro/)
	})

	it("the same sentence covers a first-party-shaped server under another name", () => {
		const v = explainServerTrust({ name: "aihydro-tools", config: JSON.stringify(stdio(NEW_CMD)) }, OLD)
		expect(v.reason).to.contain("running from a new location")
	})

	it("describeStaleAnchor: record points at a disabled entry and exactly one enabled first-party entry exists", () => {
		const entries = [
			{ name: "ai-hydro", type: "stdio", command: OLD.command, args: [], disabled: true },
			{ name: "aihydro-tools", type: "stdio", command: NEW_CMD, args: [] },
		]
		const stale = describeStaleAnchor(entries, OLD)
		expect(stale).to.deep.equal({ recordedName: "ai-hydro", state: "disabled", activeName: "aihydro-tools" })
		expect(staleAnchorNote(stale!)).to.equal("Previously trusted: ai-hydro (disabled).")
	})

	it("describeStaleAnchor: removed says removed; an enabled record, no candidate, two candidates or no record say nothing", () => {
		const tools = { name: "aihydro-tools", type: "stdio", command: NEW_CMD, args: [] }
		expect(describeStaleAnchor([tools], OLD)?.state).to.equal("removed")
		expect(describeStaleAnchor([{ name: "ai-hydro", command: OLD.command, args: [] }, tools], OLD)).to.equal(undefined)
		expect(describeStaleAnchor([{ name: "ai-hydro", command: OLD.command, args: [], disabled: true }], OLD)).to.equal(
			undefined,
		)
		expect(describeStaleAnchor([tools, { ...tools, name: "aihydro" }], OLD)).to.equal(undefined)
		expect(describeStaleAnchor([tools], undefined)).to.equal(undefined)
	})

	it("canOfferTrustAction is for first-party names only", () => {
		expect(canOfferTrustAction("aihydro-tools")).to.equal(true)
		expect(canOfferTrustAction("swat")).to.equal(false)
		expect(canOfferTrustAction(undefined)).to.equal(false)
	})

	it("firstPartyCandidates lists only enabled first-party-named, first-party-shaped stdio entries", () => {
		const tools = { name: "aihydro-tools", command: NEW_CMD, args: [] as string[] }
		const entries = [
			{ name: "ai-hydro", command: OLD.command, args: [], disabled: true },
			tools,
			{ name: "ai-hydro-2", command: NEW_CMD, args: [] }, // not a first-party name
			{ name: "aihydro", command: "/usr/bin/swat", args: [] }, // not the first-party shape
			{ name: "ai_hydro", type: "sse", command: NEW_CMD, args: [] },
		]
		expect(firstPartyCandidates(entries).map((e) => e.name)).to.deep.equal(["aihydro-tools"])
	})
})
