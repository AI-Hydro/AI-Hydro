import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import {
	findLoosenings,
	McpPolicyGate,
	type PolicyChange,
	policySnapshot,
	revertLoosenings,
	revertSettingsFile,
	type ServersLike,
} from "../policyGate"

const servers = (over: Record<string, Record<string, unknown>>): ServersLike => over as ServersLike

describe("MCP settings policy loosening (T16, T17, B3)", () => {
	describe("pure detection", () => {
		it("T16 flags an autoApprove addition, including a brand-new server that arrives with one", () => {
			const prev = servers({ "ai-hydro": { autoApprove: ["describe_tool"] } })
			const next = servers({
				"ai-hydro": { autoApprove: ["describe_tool", "run_python"] },
				fresh: { autoApprove: ["anything"] },
			})
			expect(findLoosenings(prev, next)).to.deep.equal([
				{ kind: "autoApprove-added", server: "ai-hydro", tool: "run_python" },
				{ kind: "autoApprove-added", server: "fresh", tool: "anything" },
			])
		})

		it("T16 flags trust turned on (absent or false to true)", () => {
			expect(findLoosenings(servers({ s: {} }), servers({ s: { trustAnnotations: true } }))).to.deep.equal([
				{ kind: "trust-added", server: "s" },
			])
			expect(
				findLoosenings(servers({ s: { trustAnnotations: false } }), servers({ s: { trustAnnotations: true } })),
			).to.have.length(1)
			expect(
				findLoosenings(servers({ s: { trustAnnotations: true } }), servers({ s: { trustAnnotations: true } })),
			).to.have.length(0)
		})

		it("T16 flags a deny or alwaysAsk removal", () => {
			const prev = servers({ s: { deny: ["a", "b"], alwaysAsk: ["c"] } })
			const next = servers({ s: { deny: ["a"], alwaysAsk: [] } })
			expect(findLoosenings(prev, next)).to.deep.equal([
				{ kind: "deny-removed", server: "s", tool: "b" },
				{ kind: "alwaysAsk-removed", server: "s", tool: "c" },
			])
		})

		it("T17 does not flag tightening: a deny added, autoApprove removed, trust revoked, alwaysAsk added", () => {
			const prev = servers({ s: { autoApprove: ["a", "b"], trustAnnotations: true, deny: [], alwaysAsk: [] } })
			const next = servers({ s: { autoApprove: ["a"], trustAnnotations: false, deny: ["x"], alwaysAsk: ["y"] } })
			expect(findLoosenings(prev, next)).to.deep.equal([])
		})

		it("does not flag unrelated edits (timeout, command, a server removed)", () => {
			const prev = servers({ s: { timeout: 10, command: "a", autoApprove: ["a"] }, gone: { autoApprove: ["z"] } })
			const next = servers({ s: { timeout: 99, command: "b", autoApprove: ["a"] } })
			expect(findLoosenings(prev, next)).to.deep.equal([])
		})

		it("revertLoosenings undoes exactly the loosenings and keeps tightening and unrelated edits", () => {
			const prev = servers({ s: { autoApprove: ["a"], deny: ["d"], alwaysAsk: ["k"], timeout: 1 } })
			const next = servers({
				s: { autoApprove: ["a", "run_python"], trustAnnotations: true, deny: [], alwaysAsk: ["k", "k2"], timeout: 9 },
			})
			const out = revertLoosenings(prev, next)
			expect(out.s.autoApprove).to.deep.equal(["a"])
			expect(out.s.trustAnnotations).to.equal(undefined)
			expect(out.s.deny).to.deep.equal(["d"])
			expect(out.s.alwaysAsk).to.deep.equal(["k", "k2"]) // an added ask is tightening: kept
			expect(out.s.timeout).to.equal(9) // unrelated edit: kept
		})

		it("revertLoosenings can keep the UI's own intended addition", () => {
			const prev = servers({ s: { autoApprove: [] } })
			const next = servers({ s: { autoApprove: ["wanted", "sneaked"] } })
			const out = revertLoosenings(prev, next, (c) => c.kind === "autoApprove-added" && c.tool === "wanted")
			expect(out.s.autoApprove).to.deep.equal(["wanted"])
		})

		it("policySnapshot copies only policy fields", () => {
			const snap = policySnapshot(servers({ s: { autoApprove: ["a"], command: "x", timeout: 3 } }))
			expect(snap).to.deep.equal({ s: { autoApprove: ["a"] } })
		})
	})

	describe("McpPolicyGate: what McpHub does with watcher edits and UI writes", () => {
		let dir: string
		let file: string
		let asked: PolicyChange[][]
		let answer: boolean
		let gate: McpPolicyGate

		beforeEach(async () => {
			dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-gate-"))
			file = path.join(dir, "aihydro_mcp_settings.json")
			asked = []
			answer = false
			gate = new McpPolicyGate({
				confirm: async (changes) => {
					asked.push(changes)
					return answer
				},
				revertFile: (prev) => revertSettingsFile(file, prev),
			})
			gate.setBaseline(servers({ s: { autoApprove: ["describe_tool"], deny: ["bad"] } }))
			await fs.writeFile(
				file,
				JSON.stringify({ mcpServers: { s: { command: "x", autoApprove: ["describe_tool"], deny: ["bad"] } } }),
			)
		})
		afterEach(async () => {
			await fs.rm(dir, { recursive: true, force: true })
		})

		const edit = (over: Record<string, unknown>): Record<string, Record<string, any>> => ({
			s: { type: "stdio", command: "x", autoApprove: ["describe_tool"], deny: ["bad"], ...over },
		})
		const writeFileFor = (e: ReturnType<typeof edit>) => fs.writeFile(file, JSON.stringify({ mcpServers: e }))

		it("T16 a watcher edit that adds run_python to autoApprove is not applied until confirmed", async () => {
			const e = edit({ autoApprove: ["describe_tool", "run_python"] })
			await writeFileFor(e)
			const applied = await gate.gateExternal(e)
			expect(asked).to.have.length(1)
			expect(asked[0]).to.deep.equal([{ kind: "autoApprove-added", server: "s", tool: "run_python" }])
			expect(applied.s.autoApprove).to.deep.equal(["describe_tool"])
			// The file on disk is rewritten without the loosening, so a restart cannot apply it either.
			const onDisk = JSON.parse(await fs.readFile(file, "utf-8"))
			expect(onDisk.mcpServers.s.autoApprove).to.deep.equal(["describe_tool"])
			expect(onDisk.mcpServers.s.command).to.equal("x")
		})

		it("T16 trust turned on and a deny removal are held for confirmation too", async () => {
			const e = edit({ trustAnnotations: true, deny: [] })
			await writeFileFor(e)
			const applied = await gate.gateExternal(e)
			expect(asked).to.have.length(1)
			expect(applied.s.trustAnnotations).to.equal(undefined)
			expect(applied.s.deny).to.deep.equal(["bad"])
		})

		it("T16 the edit is applied once the user confirms it, and then becomes the baseline", async () => {
			answer = true
			const e = edit({ autoApprove: ["describe_tool", "run_python"] })
			const applied = await gate.gateExternal(e)
			expect(applied.s.autoApprove).to.deep.equal(["describe_tool", "run_python"])
			asked.length = 0
			await gate.gateExternal(e)
			expect(asked).to.have.length(0)
		})

		it("T17 an edit that adds a deny applies immediately with no prompt; removing an autoApprove entry too", async () => {
			const applied = await gate.gateExternal(edit({ deny: ["bad", "worse"] }))
			expect(asked).to.have.length(0)
			expect(applied.s.deny).to.deep.equal(["bad", "worse"])
			const tightened = await gate.gateExternal(edit({ autoApprove: [], deny: ["bad", "worse"] }))
			expect(asked).to.have.length(0)
			expect(tightened.s.autoApprove).to.deep.equal([])
		})

		it("a UI write keeps its own autoApprove addition and reverts an unprocessed agent edit in the same file", () => {
			const config = {
				mcpServers: { s: { command: "x", autoApprove: ["describe_tool", "sneaked", "wanted"], deny: ["bad"] } },
			}
			const toWrite = gate.prepareUiWrite(config, { server: "s", tools: ["wanted"] })
			expect(toWrite.mcpServers.s.autoApprove).to.deep.equal(["describe_tool", "wanted"])
			gate.accept(toWrite.mcpServers as ServersLike)
			// The accepted baseline now contains "wanted" but not "sneaked".
			expect(
				findLoosenings(
					policySnapshot(servers({ s: { autoApprove: ["describe_tool", "wanted"] } })),
					servers({ s: { autoApprove: ["describe_tool", "wanted", "sneaked"] } }),
				),
			).to.have.length(1)
		})

		it("a UI write with no unintended change passes through untouched", () => {
			const config = { mcpServers: { s: { command: "x", autoApprove: ["describe_tool"], deny: ["bad"], timeout: 99 } } }
			expect(gate.prepareUiWrite(config)).to.equal(config)
		})
	})
})
