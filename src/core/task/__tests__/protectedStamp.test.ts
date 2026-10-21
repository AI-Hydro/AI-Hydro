import { expect } from "chai"
import { describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import type { AiHydroMessage } from "@/shared/ExtensionMessage"
import { computeProtectedRoots } from "../protectedPaths"
import { stampProtectedPaths, touchesProtectedPath } from "../protectedStamp"

describe("host stamp for tool rows that touch protected paths (W2-A2)", () => {
	const base = path.join(os.tmpdir(), "aihydro-stamp-test")
	const home = path.join(base, "home", "u")
	const roots = computeProtectedRoots({ homeDir: home })
	const tool = (body: Record<string, unknown>, extra: Partial<AiHydroMessage> = {}): AiHydroMessage => ({
		ts: 1,
		type: "ask",
		ask: "tool",
		text: JSON.stringify(body),
		...extra,
	})
	const mcp = (args: unknown): AiHydroMessage => ({
		ts: 2,
		type: "ask",
		ask: "use_mcp_server",
		text: JSON.stringify({ serverName: "s", toolName: "t", arguments: JSON.stringify(args) }),
	})

	it("stamps an absolute protected write and leaves an ordinary workspace write alone", () => {
		const rows = [
			tool({ tool: "editedExistingFile", path: path.join(home, ".ssh", "id_ed25519") }),
			tool({ tool: "editedExistingFile", path: path.join(base, "proj", "a.ts") }),
		]
		expect(stampProtectedPaths(rows, roots, [path.join(base, "proj")])).to.equal(1)
		expect(rows[0].policyClass).to.equal("protected_path")
		expect(rows[1].policyClass).to.equal(undefined)
	})

	it("catches a workspace-relative path when the workspace itself sits under a protected root", () => {
		const ws = path.join(home, ".ssh")
		expect(touchesProtectedPath(tool({ tool: "newFileCreated", path: "id" }), roots, [ws])).to.equal(true)
		const aihydro = path.join(home, ".aihydro")
		expect(touchesProtectedPath(tool({ tool: "newFileCreated", path: "approvals/x.json" }), roots, [aihydro])).to.equal(true)
		expect(touchesProtectedPath(tool({ tool: "newFileCreated", path: "notes/x.json" }), roots, [aihydro])).to.equal(false)
	})

	it("stamps an MCP call whose arguments name a protected file, and expands ~", () => {
		expect(touchesProtectedPath(mcp({ output_path: path.join(home, ".aihydro", "trust", "k") }), roots, [])).to.equal(true)
		expect(touchesProtectedPath(mcp({ gauge_id: "SYN-1", period: "1990-2020" }), roots, [])).to.equal(false)
		expect(touchesProtectedPath(mcp({ files: [path.join(base, "ok.txt")] }), roots, [])).to.equal(false)
	})

	it("does not overwrite an existing policy class and ignores other row kinds", () => {
		const row = tool({ path: path.join(home, ".ssh", "x") }, { policyClass: "auto_run_all" })
		const other: AiHydroMessage = {
			ts: 3,
			type: "say",
			say: "text",
			text: JSON.stringify({ path: path.join(home, ".ssh", "x") }),
		}
		expect(stampProtectedPaths([row, other], roots, [])).to.equal(0)
		expect(row.policyClass).to.equal("auto_run_all")
	})

	it("matches camelCase and other path-like keys, file:// URIs, absolute values under any key, and nested file objects", () => {
		const prot = path.join(home, ".ssh", "id")
		for (const key of [
			"outputPath",
			"targetPath",
			"destPath",
			"savePath",
			"outputFile",
			"outDir",
			"target",
			"to",
			"location",
			"uri",
		]) {
			expect(touchesProtectedPath(mcp({ [key]: prot }), roots, []), key).to.equal(true)
		}
		expect(touchesProtectedPath(mcp({ uri: `file://${prot}` }), roots, [])).to.equal(true)
		expect(touchesProtectedPath(mcp({ files: [{ name: prot }] }), roots, [])).to.equal(true)
		// whatever the key, an absolute or ~ value is checked
		expect(touchesProtectedPath(mcp({ whatever: prot }), roots, [])).to.equal(true)
		expect(touchesProtectedPath(mcp({ note: `file://${prot}` }), roots, [])).to.equal(true)
		expect(touchesProtectedPath(mcp({ note: "~/.ssh/id" }), roots, [])).to.equal(os.homedir() === home)
		// ordinary arguments stay unstamped
		expect(touchesProtectedPath(mcp({ outputPath: path.join(base, "proj", "out.csv"), note: "hello" }), roots, [])).to.equal(
			false,
		)
	})

	it("a call too large to walk is stamped (uninspected over-lift), not skipped", () => {
		const big = Array.from({ length: 6000 }, (_, i) => ({ i }))
		expect(touchesProtectedPath(mcp({ rows: big }), roots, [])).to.equal(true)
		// deep nesting does not overflow the stack
		let deep: unknown = { x: 1 }
		for (let i = 0; i < 400; i++) {
			deep = { a: deep }
		}
		expect(() => touchesProtectedPath(mcp({ deep }), roots, [])).to.not.throw()
	})
})
