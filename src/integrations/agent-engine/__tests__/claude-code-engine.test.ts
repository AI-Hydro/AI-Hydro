import { expect } from "chai"
import proxyquire from "proxyquire"
import sinon from "sinon"
import type { EngineEvent } from "../types"

const createMockProcess = (opts: { onError?: Error; exitCode?: number } = {}) => {
	// Mirror real execa with `reject: false` (verified empirically against the
	// installed execa version): the child's own promise ALWAYS resolves, even
	// on a spawn failure — it never rejects, and `failed` is true whenever
	// exitCode !== 0 (not only on a spawn error). A mock that rejects on
	// onError, or that omits `failed` for a plain non-zero exit, hides real
	// bugs in code that must read the resolved result's own fields.
	const exitCode = opts.onError ? undefined : (opts.exitCode ?? 0)
	const failed = Boolean(opts.onError) || exitCode !== 0
	const settled = Promise.resolve({
		exitCode,
		failed,
		code: opts.onError ? (opts.onError as any).code : undefined,
		shortMessage: failed ? `Command failed with exit code ${exitCode}` : undefined,
	})

	const mockProcess: any = {
		stdout: {},
		stderr: { on: sinon.fake() },
		on: sinon.fake((event: string, callback: (arg?: unknown) => void) => {
			if (event === "close") {
				setImmediate(() => callback(opts.onError ? -2 : (opts.exitCode ?? 0)))
			}
			if (event === "error" && opts.onError) {
				setImmediate(() => callback(opts.onError))
			}
		}),
		killed: false,
		kill: sinon.fake(),
		then: (onResolve: (value: unknown) => void, onReject?: (err: unknown) => void) => settled.then(onResolve, onReject),
		catch: (onReject: (err: unknown) => void) => settled.catch(onReject),
	}
	return mockProcess
}

const createMockReadlineInterface = (lines: string[]) => ({
	async *[Symbol.asyncIterator]() {
		for (const line of lines) {
			yield line
		}
	},
	close: sinon.fake(),
})

function loadEngine(lines: string[], execaOpts: { onError?: Error; exitCode?: number } = {}) {
	const mockExeca = sinon.fake(() => createMockProcess(execaOpts))
	const { ClaudeCodeEngine } = proxyquire("../claude-code-engine", {
		execa: { execa: mockExeca },
		readline: { createInterface: () => createMockReadlineInterface(lines) },
		"@noCallThru": false,
	})
	return { ClaudeCodeEngine, mockExeca }
}

async function collect(gen: AsyncGenerator<EngineEvent>): Promise<EngineEvent[]> {
	const out: EngineEvent[] = []
	for await (const ev of gen) {
		out.push(ev)
	}
	return out
}

describe("ClaudeCodeEngine", function () {
	// First test in this file pays a one-time ts-node cold-compile cost for
	// this file's proxyquire'd aliased dependency graph, occasionally
	// exceeding mocha's default 2000ms (see mcp-config.test.ts for the same fix).
	this.timeout(10000)
	afterEach(() => sinon.restore())

	describe("argument construction", () => {
		it("runs its own loop: no --max-turns and no --disallowedTools", async () => {
			const { ClaudeCodeEngine, mockExeca } = loadEngine([])
			const engine = new ClaudeCodeEngine()
			await collect(
				engine.run({
					task: "do the thing",
					mcpConfigPath: "/tmp/mcp.json",
					cwd: "/tmp/work",
					permissionPosture: "scoped-write",
				}),
			)
			const args: string[] = (mockExeca.lastCall!.args as any[])[1]
			expect(args).to.not.include("--max-turns")
			expect(args).to.not.include("--disallowedTools")
		})

		it("attaches the MCP config and pins it as the only server source", async () => {
			const { ClaudeCodeEngine, mockExeca } = loadEngine([])
			const engine = new ClaudeCodeEngine()
			await collect(
				engine.run({
					task: "do the thing",
					mcpConfigPath: "/tmp/mcp.json",
					cwd: "/tmp/work",
					permissionPosture: "scoped-write",
				}),
			)
			const args: string[] = (mockExeca.lastCall!.args as any[])[1]
			expect(args).to.include("--mcp-config")
			expect(args[args.indexOf("--mcp-config") + 1]).to.equal("/tmp/mcp.json")
			expect(args).to.include("--strict-mcp-config")
		})

		it("never requests bypassPermissions; scoped-write maps to acceptEdits", async () => {
			const { ClaudeCodeEngine, mockExeca } = loadEngine([])
			const engine = new ClaudeCodeEngine()
			await collect(
				engine.run({
					task: "do the thing",
					mcpConfigPath: "/tmp/mcp.json",
					cwd: "/tmp/work",
					permissionPosture: "scoped-write",
				}),
			)
			const args: string[] = (mockExeca.lastCall!.args as any[])[1]
			expect(args).to.not.include("bypassPermissions")
			expect(args[args.indexOf("--permission-mode") + 1]).to.equal("acceptEdits")
		})

		it("read-only posture maps to plan mode, not acceptEdits", async () => {
			const { ClaudeCodeEngine, mockExeca } = loadEngine([])
			const engine = new ClaudeCodeEngine()
			await collect(
				engine.run({
					task: "do the thing",
					mcpConfigPath: "/tmp/mcp.json",
					cwd: "/tmp/work",
					permissionPosture: "read-only",
				}),
			)
			const args: string[] = (mockExeca.lastCall!.args as any[])[1]
			expect(args[args.indexOf("--permission-mode") + 1]).to.equal("plan")
		})

		it("scopes writes to cwd via --add-dir", async () => {
			const { ClaudeCodeEngine, mockExeca } = loadEngine([])
			const engine = new ClaudeCodeEngine()
			await collect(
				engine.run({
					task: "do the thing",
					mcpConfigPath: "/tmp/mcp.json",
					cwd: "/tmp/work",
					permissionPosture: "scoped-write",
				}),
			)
			const args: string[] = (mockExeca.lastCall!.args as any[])[1]
			expect(args[args.indexOf("--add-dir") + 1]).to.equal("/tmp/work")
		})

		it("deletes ANTHROPIC_API_KEY so auth resolves to the CLI's own subscription", async () => {
			const { ClaudeCodeEngine, mockExeca } = loadEngine([])
			const engine = new ClaudeCodeEngine()
			process.env.ANTHROPIC_API_KEY = "sk-should-not-survive"
			await collect(
				engine.run({
					task: "do the thing",
					mcpConfigPath: "/tmp/mcp.json",
					cwd: "/tmp/work",
					permissionPosture: "scoped-write",
				}),
			)
			const spawnOpts = (mockExeca.lastCall!.args as any[])[2]
			expect(spawnOpts.env.ANTHROPIC_API_KEY).to.be.undefined
			delete process.env.ANTHROPIC_API_KEY
		})
	})

	describe("event normalization", () => {
		it("maps a full stream-json turn to the normalized EngineEvent union", async () => {
			const lines = [
				JSON.stringify({ type: "system", subtype: "init", apiKeySource: "none" }),
				JSON.stringify({
					type: "assistant",
					message: { content: [{ type: "text", text: "Looking into it." }] },
				}),
				JSON.stringify({
					type: "assistant",
					message: { content: [{ type: "tool_use", id: "tu_1", name: "add_note", input: { note: "x" } }] },
				}),
				JSON.stringify({
					type: "user",
					message: { content: [{ type: "tool_result", tool_use_id: "tu_1", content: "ok", is_error: false }] },
				}),
				JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "done", total_cost_usd: 0 }),
			]
			const { ClaudeCodeEngine } = loadEngine(lines)
			const engine = new ClaudeCodeEngine()
			const events = await collect(
				engine.run({
					task: "do the thing",
					mcpConfigPath: "/tmp/mcp.json",
					cwd: "/tmp/work",
					permissionPosture: "scoped-write",
				}),
			)

			expect(events).to.deep.include({ type: "text", text: "Looking into it." })
			expect(events).to.deep.include({ type: "tool_use", id: "tu_1", name: "add_note", input: { note: "x" } })
			expect(events).to.deep.include({ type: "tool_result", toolUseId: "tu_1", content: "ok", isError: false })

			const usage = events.find((e) => e.type === "usage")
			expect(usage).to.exist
			// apiKeySource "none" => subscription auth, not a metered per-token API key.
			expect((usage as any).isPaidUsage).to.equal(false)

			const done = events.find((e) => e.type === "done")
			expect(done).to.deep.include({ type: "done", success: true, summary: "done" })
		})

		it("surfaces an unrecognized message shape as a raw event instead of dropping it", async () => {
			const lines = [JSON.stringify({ type: "some_future_shape", foo: "bar" })]
			const { ClaudeCodeEngine } = loadEngine(lines)
			const engine = new ClaudeCodeEngine()
			const events = await collect(
				engine.run({
					task: "do the thing",
					mcpConfigPath: "/tmp/mcp.json",
					cwd: "/tmp/work",
					permissionPosture: "scoped-write",
				}),
			)
			expect(events).to.have.length(1)
			expect(events[0]).to.deep.equal({
				type: "raw",
				source: "claude-code",
				data: { type: "some_future_shape", foo: "bar" },
			})
		})

		it("salvages a truncated trailing message instead of silently losing it", async () => {
			const truncated = '{"type":"assistant","message":{"content":[{"type":"text","text":"cut off mid'
			const { ClaudeCodeEngine } = loadEngine([truncated])
			const engine = new ClaudeCodeEngine()
			const events = await collect(
				engine.run({
					task: "do the thing",
					mcpConfigPath: "/tmp/mcp.json",
					cwd: "/tmp/work",
					permissionPosture: "scoped-write",
				}),
			)
			expect(events).to.deep.include({ type: "raw", source: "claude-code", data: truncated })
		})

		it("flags a non-subscription apiKeySource as metered/paid usage", async () => {
			const lines = [
				JSON.stringify({ type: "system", subtype: "init", apiKeySource: "user" }),
				JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "done" }),
			]
			const { ClaudeCodeEngine } = loadEngine(lines)
			const engine = new ClaudeCodeEngine()
			const events = await collect(
				engine.run({
					task: "do the thing",
					mcpConfigPath: "/tmp/mcp.json",
					cwd: "/tmp/work",
					permissionPosture: "scoped-write",
				}),
			)
			const usage = events.find((e) => e.type === "usage")
			expect((usage as any).isPaidUsage).to.equal(true)
		})
	})

	describe("error handling", () => {
		it("raises a friendly error when the claude binary is missing (ENOENT)", async () => {
			const { ClaudeCodeEngine } = loadEngine([], {
				onError: Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }),
			})
			const engine = new ClaudeCodeEngine()
			let thrown: Error | undefined
			try {
				await collect(
					engine.run({
						task: "do the thing",
						mcpConfigPath: "/tmp/mcp.json",
						cwd: "/tmp/work",
						permissionPosture: "scoped-write",
					}),
				)
			} catch (err) {
				thrown = err as Error
			}
			expect(thrown).to.exist
			expect(thrown!.message).to.include("Failed to find the claude executable")
		})

		it("yields a normalized done:false event when the process exits non-zero without a spawn error", async () => {
			const { ClaudeCodeEngine } = loadEngine([], { exitCode: 3 })
			const engine = new ClaudeCodeEngine()
			const events = await collect(
				engine.run({
					task: "do the thing",
					mcpConfigPath: "/tmp/mcp.json",
					cwd: "/tmp/work",
					permissionPosture: "scoped-write",
				}),
			)
			const done = events.find((e) => e.type === "done")
			expect(done).to.exist
			expect((done as any).success).to.equal(false)
			expect((done as any).summary).to.include("exited with code 3")
		})
	})
})
