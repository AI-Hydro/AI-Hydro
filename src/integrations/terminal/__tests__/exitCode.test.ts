import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { parseExitFromChunk } from "../shellExit"
import { TerminalProcess } from "../TerminalProcess"

const ESC = "\x1b"
const osc = (body: string) => `${ESC}]633;${body}\x07`

describe("parseExitFromChunk (OSC 633;D)", () => {
	it("reads the exit code after the command's pre-execution mark", () => {
		expect(parseExitFromChunk(`${osc("C")}out\n${osc("D;0")}`)).to.equal(0)
		expect(parseExitFromChunk(`${osc("C")}out\n${osc("D;127")}`)).to.equal(127)
	})

	it("ignores the previous prompt's D that precedes this command's C", () => {
		expect(parseExitFromChunk(`${osc("D;0")}${osc("A")}${osc("B")}${osc("C")}boom\n${osc("D;2")}`)).to.equal(2)
		// previous D only: this command has not finished in this chunk
		expect(parseExitFromChunk(`${osc("D;0")}${osc("C")}still running`)).to.equal(undefined)
	})

	it("a D with no code is unknown; no D is undefined", () => {
		expect(parseExitFromChunk(`${osc("C")}x${osc("D")}`)).to.equal("unknown")
		expect(parseExitFromChunk("plain output")).to.equal(undefined)
	})
})

describe("TerminalProcess exit code (W2-0h)", () => {
	const win = vscode.window as any
	let savedOnEnd: unknown

	beforeEach(() => {
		// The no-shell-integration fallback reads the terminal via the clipboard; give it an inert host.
		HostProvider.reset()
		HostProvider.initialize(
			(() => {}) as any,
			(() => {}) as any,
			{ envClient: { clipboardReadText: async () => ({ value: "" }), clipboardWriteText: async () => ({}) } } as any,
			() => {},
			async () => "",
			async () => "",
			"/mock/extension",
			"/mock/storage",
		)
		savedOnEnd = win.onDidEndTerminalShellExecution
		delete win.onDidEndTerminalShellExecution // exercise the stream mark; individual tests install the event
	})
	afterEach(() => {
		HostProvider.reset()
		win.onDidEndTerminalShellExecution = savedOnEnd
	})

	const terminalWith = (chunks: string[]) => {
		const execution = {
			read: () =>
				(async function* () {
					for (const c of chunks) {
						yield c
					}
				})(),
		}
		return {
			terminal: { shellIntegration: { executeCommand: () => execution }, sendText: () => {} } as unknown as vscode.Terminal,
			execution,
		}
	}

	it("records a non-zero exit from the stream mark", async () => {
		const { terminal } = terminalWith([`${osc("C")}boom\n${osc("D;2")}`])
		const p = new TerminalProcess()
		await p.run(terminal, "false")
		expect(p.exitCode).to.equal(2)
	})

	it("records zero from the stream mark", async () => {
		const { terminal } = terminalWith([`${osc("C")}ok\n${osc("D;0")}`])
		const p = new TerminalProcess()
		await p.run(terminal, "true")
		expect(p.exitCode).to.equal(0)
	})

	it("records unknown, never success, when no code is reported", async () => {
		const { terminal } = terminalWith([`${osc("C")}ok\n`])
		const p = new TerminalProcess()
		await p.run(terminal, "true")
		expect(p.exitCode).to.equal("unknown")
	})

	it("prefers the end-of-execution event's code", async () => {
		const { terminal, execution } = terminalWith([`${osc("C")}ok\n`])
		let fire: (e: { execution: unknown; exitCode: number | undefined }) => void = () => {}
		win.onDidEndTerminalShellExecution = (listener: typeof fire) => {
			fire = listener
			return { dispose: () => {} }
		}
		const p = new TerminalProcess()
		const done = p.run(terminal, "false")
		setTimeout(() => fire({ execution, exitCode: 9 }), 5)
		await done
		expect(p.exitCode).to.equal(9)
	})

	it("ignores another execution's end event", async () => {
		const { terminal } = terminalWith([`${osc("C")}ok\n`])
		let fire: (e: { execution: unknown; exitCode: number | undefined }) => void = () => {}
		win.onDidEndTerminalShellExecution = (listener: typeof fire) => {
			fire = listener
			return { dispose: () => {} }
		}
		const p = new TerminalProcess()
		const done = p.run(terminal, "true")
		setTimeout(() => fire({ execution: {}, exitCode: 9 }), 5)
		await done
		expect(p.exitCode).to.equal("unknown")
	})

	it("records unknown when the terminal has no shell integration", async () => {
		const terminal = { shellIntegration: undefined, sendText: () => {} } as unknown as vscode.Terminal
		const p = new TerminalProcess()
		const orig = global.setTimeout
		;(global as any).setTimeout = (fn: () => void) => orig(fn, 0)
		try {
			await p.run(terminal, "true")
		} finally {
			global.setTimeout = orig
		}
		expect(p.exitCode).to.equal("unknown")
	})
})
