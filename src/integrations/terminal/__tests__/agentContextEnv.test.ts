import { expect } from "chai"
import * as fs from "fs"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as path from "path"
import * as vscode from "vscode"
import { buildStdioServerEnv } from "@/services/mcp/serverEnv"
import { TerminalRegistry } from "../TerminalRegistry"

/**
 * T28: every agent execution surface carries AIHYDRO_AGENT_CONTEXT=1 (approval redesign AP1, B4), so the approval
 * CLI refuses to approve a claim from any of them.
 */
describe("agent-context marker on agent surfaces (T28)", () => {
	const win = vscode.window as any
	const api = vscode as any
	let savedCreate: unknown
	let savedThemeIcon: unknown
	let created: any[]

	beforeEach(() => {
		savedCreate = win.createTerminal
		savedThemeIcon = api.ThemeIcon
		created = []
		win.createTerminal = (options: unknown) => {
			created.push(options)
			return { show: () => {}, exitStatus: undefined }
		}
		api.ThemeIcon = class {
			constructor(public id: string) {}
		}
	})
	afterEach(() => {
		win.createTerminal = savedCreate
		api.ThemeIcon = savedThemeIcon
	})

	it("TerminalRegistry agent terminals carry the marker (also used by CLI subagent launches)", () => {
		TerminalRegistry.createTerminal("/work")
		expect(created).to.have.length(1)
		expect(created[0].env.AIHYDRO_AGENT_CONTEXT).to.equal("1")
	})

	it("hostbridge executeCommandInTerminal terminals carry the marker", async () => {
		const { executeCommandInTerminal } = await import("@/hosts/vscode/hostbridge/workspace/executeCommandInTerminal")
		const sent: string[] = []
		win.createTerminal = (options: unknown) => {
			created.push(options)
			return { show: () => {}, sendText: (t: string) => sent.push(t) }
		}
		await executeCommandInTerminal({ command: "echo hi" } as any)
		expect(created).to.have.length(1)
		expect(created[0].env.AIHYDRO_AGENT_CONTEXT).to.equal("1")
	})

	it("MCP stdio servers launched by the extension carry the marker, and a settings env cannot clear it", () => {
		expect(buildStdioServerEnv(undefined).AIHYDRO_AGENT_CONTEXT).to.equal("1")
		expect(buildStdioServerEnv({ AIHYDRO_AGENT_CONTEXT: "0", TMPDIR: "/x" }).AIHYDRO_AGENT_CONTEXT).to.equal("1")
		expect(buildStdioServerEnv({ TMPDIR: "/x" }).TMPDIR).to.equal("/x")
	})

	// The remaining two surfaces run in a child process that a unit test cannot start without a shell host, so the
	// assertion is on the source: the spawn/execa call must set the marker.
	it("backgroundExec (standalone terminal) and test-mode executeCommandInNode set the marker in the spawn env", () => {
		const root = path.resolve(__dirname, "../../../..")
		const standalone = fs.readFileSync(path.join(root, "standalone/runtime-files/vscode/enhanced-terminal.js"), "utf8")
		expect(standalone).to.match(/env:\s*\{[^}]*AIHYDRO_AGENT_CONTEXT:\s*"1"/)
		const task = fs.readFileSync(path.join(root, "src/core/task/index.ts"), "utf8")
		expect(task).to.match(/env:\s*\{\s*AIHYDRO_AGENT_CONTEXT:\s*"1"\s*\}/)
	})
})
