import { expect } from "chai"
import proxyquire from "proxyquire"
import sinon from "sinon"
import type { EngineEvent } from "../types"

const createMockProcess = (opts: { onError?: Error; exitCode?: number } = {}) => {
	// Mirror real execa with `reject: false` — see claude-code-engine.test.ts
	// for the empirically-verified rationale (the child promise always
	// resolves; `failed` is true whenever exitCode !== 0).
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

function loadEngine(
	lines: string[],
	execaOpts: { onError?: Error; exitCode?: number } = {},
	serverConfig: { command: string; args?: string[] } = { command: "/opt/miniconda3/bin/aihydro-mcp" },
) {
	const mockExeca = sinon.fake(() => createMockProcess(execaOpts))
	const { CodexEngine } = proxyquire("../codex-engine", {
		execa: { execa: mockExeca },
		readline: { createInterface: () => createMockReadlineInterface(lines) },
		"./mcp-config": { readAihydroServerConfig: sinon.fake.resolves(serverConfig) },
		"@noCallThru": false,
	})
	return { CodexEngine, mockExeca }
}

async function collect(gen: AsyncGenerator<EngineEvent>): Promise<EngineEvent[]> {
	const out: EngineEvent[] = []
	for await (const ev of gen) {
		out.push(ev)
	}
	return out
}

const baseOptions = {
	task: "do the thing",
	mcpConfigPath: "/tmp/unused-for-codex.json",
	cwd: "/tmp/work",
	permissionPosture: "scoped-write" as const,
}

describe("CodexEngine", function () {
	// First test in this file pays a one-time ts-node cold-compile cost for
	// this file's proxyquire'd aliased dependency graph (see mcp-config.test.ts).
	this.timeout(10000)
	afterEach(() => sinon.restore())

	describe("argument construction", () => {
		it("runs `codex exec <task>` with --json output", async () => {
			const { CodexEngine, mockExeca } = loadEngine([])
			const engine = new CodexEngine()
			await collect(engine.run(baseOptions))
			const args: string[] = (mockExeca.lastCall!.args as any[])[1]
			expect(args[0]).to.equal("exec")
			expect(args[1]).to.equal("do the thing")
			expect(args).to.include("--json")
		})

		it("attaches the ai-hydro MCP server via a config override, not a --mcp-config file", async () => {
			const { CodexEngine, mockExeca } = loadEngine([], {}, { command: "/opt/miniconda3/bin/aihydro-mcp" })
			const engine = new CodexEngine()
			await collect(engine.run(baseOptions))
			const args: string[] = (mockExeca.lastCall!.args as any[])[1]
			expect(args).to.not.include("--mcp-config")
			const overrideIndex = args.indexOf("-c")
			expect(overrideIndex).to.be.greaterThan(-1)
			expect(args[overrideIndex + 1]).to.equal('mcp_servers.ai-hydro.command="/opt/miniconda3/bin/aihydro-mcp"')
		})

		it("includes the server's args override only when args are non-empty", async () => {
			const { CodexEngine, mockExeca } = loadEngine([], {}, { command: "aihydro-mcp", args: ["-m", "ai_hydro.mcp"] })
			const engine = new CodexEngine()
			await collect(engine.run(baseOptions))
			const args: string[] = (mockExeca.lastCall!.args as any[])[1]
			expect(args).to.include('mcp_servers.ai-hydro.args=["-m","ai_hydro.mcp"]')
		})

		it("never requests danger-full-access; scoped-write maps to workspace-write", async () => {
			const { CodexEngine, mockExeca } = loadEngine([])
			const engine = new CodexEngine()
			await collect(engine.run(baseOptions))
			const args: string[] = (mockExeca.lastCall!.args as any[])[1]
			expect(args).to.not.include("danger-full-access")
			expect(args[args.indexOf("--sandbox") + 1]).to.equal("workspace-write")
		})

		it("never emits codex's full bypass escape hatch, for either posture", async () => {
			for (const permissionPosture of ["read-only", "scoped-write"] as const) {
				const { CodexEngine, mockExeca } = loadEngine([])
				const engine = new CodexEngine()
				await collect(engine.run({ ...baseOptions, permissionPosture }))
				const args: string[] = (mockExeca.lastCall!.args as any[])[1]
				expect(args).to.not.include("--dangerously-bypass-approvals-and-sandbox")
			}
		})

		it("forwards the real ai-hydro config's cwd/env/timeout shape's env, since codex's --env flag confirms env override support", async () => {
			const realShapeConfig = {
				command: "/opt/miniconda3/bin/aihydro-mcp",
				args: [],
				cwd: "/Users/x/.aihydro/cache",
				timeout: 600,
				env: { TMPDIR: "/Users/x/.aihydro/cache", TEMP: "/Users/x/.aihydro/cache", TMP: "/Users/x/.aihydro/cache" },
			}
			const { CodexEngine, mockExeca } = loadEngine([], {}, realShapeConfig)
			const engine = new CodexEngine()
			await collect(engine.run(baseOptions))
			const args: string[] = (mockExeca.lastCall!.args as any[])[1]
			expect(args).to.include(`mcp_servers.ai-hydro.env=${JSON.stringify(realShapeConfig.env)}`)
		})

		it("read-only posture maps to the read-only sandbox", async () => {
			const { CodexEngine, mockExeca } = loadEngine([])
			const engine = new CodexEngine()
			await collect(engine.run({ ...baseOptions, permissionPosture: "read-only" }))
			const args: string[] = (mockExeca.lastCall!.args as any[])[1]
			expect(args[args.indexOf("--sandbox") + 1]).to.equal("read-only")
		})

		it("always passes -a never (no TTY to answer an approval prompt headlessly)", async () => {
			const { CodexEngine, mockExeca } = loadEngine([])
			const engine = new CodexEngine()
			await collect(engine.run(baseOptions))
			const args: string[] = (mockExeca.lastCall!.args as any[])[1]
			expect(args[args.indexOf("-a") + 1]).to.equal("never")
		})

		it("scopes the working root via -C", async () => {
			const { CodexEngine, mockExeca } = loadEngine([])
			const engine = new CodexEngine()
			await collect(engine.run(baseOptions))
			const args: string[] = (mockExeca.lastCall!.args as any[])[1]
			expect(args[args.indexOf("-C") + 1]).to.equal("/tmp/work")
		})

		it("ignores stdin so an inherited pipe can't stall the process waiting for extra prompt content", async () => {
			const { CodexEngine, mockExeca } = loadEngine([])
			const engine = new CodexEngine()
			await collect(engine.run(baseOptions))
			const spawnOpts = (mockExeca.lastCall!.args as any[])[2]
			expect(spawnOpts.stdin).to.equal("ignore")
		})
	})

	describe("event normalization", () => {
		it("ignores thread.started and turn.started (no event)", async () => {
			const lines = [JSON.stringify({ type: "thread.started", thread_id: "t1" }), JSON.stringify({ type: "turn.started" })]
			const { CodexEngine } = loadEngine(lines)
			const engine = new CodexEngine()
			const events = await collect(engine.run(baseOptions))
			expect(events).to.have.length(0)
		})

		it("maps an mcp_tool_call item to normalized tool_use/tool_result with claude-style naming", async () => {
			const lines = [
				JSON.stringify({
					type: "item.started",
					item: {
						id: "item_1",
						type: "mcp_tool_call",
						server: "ai-hydro",
						tool: "add_note",
						arguments: { note: "x" },
						status: "in_progress",
					},
				}),
				JSON.stringify({
					type: "item.completed",
					item: {
						id: "item_1",
						type: "mcp_tool_call",
						server: "ai-hydro",
						tool: "add_note",
						result: { ok: true },
						status: "completed",
					},
				}),
			]
			const { CodexEngine } = loadEngine(lines)
			const engine = new CodexEngine()
			const events = await collect(engine.run(baseOptions))
			expect(events).to.deep.include({
				type: "tool_use",
				id: "item_1",
				name: "mcp__ai-hydro__add_note",
				input: { note: "x" },
			})
			expect(events).to.deep.include({ type: "tool_result", toolUseId: "item_1", content: { ok: true }, isError: false })
		})

		it("flags a failed mcp_tool_call as an error tool_result", async () => {
			const lines = [
				JSON.stringify({
					type: "item.completed",
					item: {
						id: "item_1",
						type: "mcp_tool_call",
						server: "ai-hydro",
						tool: "add_note",
						error: { message: "user cancelled MCP tool call" },
						status: "failed",
					},
				}),
			]
			const { CodexEngine } = loadEngine(lines)
			const engine = new CodexEngine()
			const events = await collect(engine.run(baseOptions))
			expect(events).to.deep.include({
				type: "tool_result",
				toolUseId: "item_1",
				content: { message: "user cancelled MCP tool call" },
				isError: true,
			})
		})

		it("maps a command_execution item to tool_use/tool_result", async () => {
			const lines = [
				JSON.stringify({
					type: "item.started",
					item: { id: "item_2", type: "command_execution", command: "ls", status: "in_progress" },
				}),
				JSON.stringify({
					type: "item.completed",
					item: {
						id: "item_2",
						type: "command_execution",
						command: "ls",
						aggregated_output: "a.txt\n",
						exit_code: 0,
						status: "completed",
					},
				}),
			]
			const { CodexEngine } = loadEngine(lines)
			const engine = new CodexEngine()
			const events = await collect(engine.run(baseOptions))
			expect(events).to.deep.include({
				type: "tool_use",
				id: "item_2",
				name: "command_execution",
				input: { command: "ls" },
			})
			expect(events).to.deep.include({ type: "tool_result", toolUseId: "item_2", content: "a.txt\n", isError: false })
		})

		it("maps an agent_message item.completed to a text event", async () => {
			const lines = [
				JSON.stringify({ type: "item.completed", item: { id: "item_3", type: "agent_message", text: "Done." } }),
			]
			const { CodexEngine } = loadEngine(lines)
			const engine = new CodexEngine()
			const events = await collect(engine.run(baseOptions))
			expect(events).to.deep.include({ type: "text", text: "Done." })
		})

		it("maps turn.completed usage fields and yields a final done:true", async () => {
			const lines = [
				JSON.stringify({
					type: "turn.completed",
					usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20, reasoning_output_tokens: 5 },
				}),
			]
			const { CodexEngine } = loadEngine(lines)
			const engine = new CodexEngine()
			const events = await collect(engine.run(baseOptions))
			const usage = events.find((e) => e.type === "usage") as any
			expect(usage).to.exist
			expect(usage.inputTokens).to.equal(100)
			expect(usage.outputTokens).to.equal(20)
			expect(usage.cacheReadTokens).to.equal(40)
			expect(usage.isPaidUsage).to.equal(false)
			expect(events).to.deep.include({ type: "done", success: true })
		})

		it("surfaces an unrecognized top-level event type as a raw event instead of dropping it", async () => {
			const lines = [JSON.stringify({ type: "some_future_event", foo: "bar" })]
			const { CodexEngine } = loadEngine(lines)
			const engine = new CodexEngine()
			const events = await collect(engine.run(baseOptions))
			expect(events).to.deep.equal([{ type: "raw", source: "codex", data: { type: "some_future_event", foo: "bar" } }])
		})

		it("surfaces an unrecognized item type as a raw event instead of dropping it", async () => {
			const lines = [JSON.stringify({ type: "item.completed", item: { id: "item_9", type: "some_future_item" } })]
			const { CodexEngine } = loadEngine(lines)
			const engine = new CodexEngine()
			const events = await collect(engine.run(baseOptions))
			expect(events).to.deep.equal([{ type: "raw", source: "codex", data: { id: "item_9", type: "some_future_item" } }])
		})
	})

	describe("error handling", () => {
		it("raises a friendly error when the codex binary is missing (ENOENT)", async () => {
			const { CodexEngine } = loadEngine([], {
				onError: Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" }),
			})
			const engine = new CodexEngine()
			let thrown: Error | undefined
			try {
				await collect(engine.run(baseOptions))
			} catch (err) {
				thrown = err as Error
			}
			expect(thrown).to.exist
			expect(thrown!.message).to.include("Failed to find the codex executable")
		})

		it("yields a normalized done:false event when the process exits non-zero without a spawn error", async () => {
			const { CodexEngine } = loadEngine([], { exitCode: 3 })
			const engine = new CodexEngine()
			const events = await collect(engine.run(baseOptions))
			const done = events.find((e) => e.type === "done")
			expect(done).to.exist
			expect((done as any).success).to.equal(false)
			expect((done as any).summary).to.include("exited with code 3")
		})

		it("propagates a clear error when the ai-hydro server isn't registered yet, before spawning codex", async () => {
			const mockExeca = sinon.fake(() => createMockProcess())
			const { CodexEngine } = proxyquire("../codex-engine", {
				execa: { execa: mockExeca },
				readline: { createInterface: () => createMockReadlineInterface([]) },
				"./mcp-config": { readAihydroServerConfig: sinon.fake.rejects(new Error('"ai-hydro" is not registered')) },
				"@noCallThru": false,
			})
			const engine = new CodexEngine()
			let thrown: Error | undefined
			try {
				await collect(engine.run(baseOptions))
			} catch (err) {
				thrown = err as Error
			}
			expect(thrown).to.exist
			expect(thrown!.message).to.include("is not registered")
			expect(mockExeca.called).to.equal(false)
		})
	})
})
