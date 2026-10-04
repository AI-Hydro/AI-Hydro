import { execa } from "execa"
import readline from "readline"
import { type AihydroStdioServerConfig, readAihydroServerConfig } from "./mcp-config"
import { toCodexSandboxPosture } from "./permission-posture"
import type { AgentEngine, AgentEngineCapabilities, AgentEngineRunOptions, EngineEvent } from "./types"

const ENGINE_TIMEOUT_MS = 1_800_000 // 30 minutes — see claude-code-engine.ts for the same reasoning.
const BUFFER_SIZE = 20_000_000 // 20 MB

type ProcessState = {
	partialData: string | null
	stderrLogs: string
}

/**
 * Drives `codex exec` as an autonomous agent engine with the aihydro-mcp
 * server attached. Unlike claude, codex exec:
 *   - takes a prompt string/stdin, not a messages array — engine mode passes
 *     the task as a positional argument.
 *   - has no --mcp-config file flag; the MCP server is attached via
 *     `-c mcp_servers.<name>.<field>=<toml value>` overrides instead.
 *   - splits permission control across two independent flags: --sandbox
 *     (file/shell access) and -a/--ask-for-approval (interactive gating).
 *     There is no TTY in headless engine mode, so approval must be "never" —
 *     confirmed live: without it, MCP tool calls are auto-cancelled
 *     ("user cancelled MCP tool call") rather than executing.
 */
export class CodexEngine implements AgentEngine {
	readonly id = "codex" as const

	async *run(options: AgentEngineRunOptions): AsyncGenerator<EngineEvent> {
		const binaryPath = options.binaryPath?.trim() || "codex"
		const serverConfig = await readAihydroServerConfig()
		const args = buildArgs(options, serverConfig)

		const child = execa(binaryPath, args, {
			// codex exec reads additional prompt content from stdin if it isn't
			// closed (confirmed live: an inherited, non-TTY stdin produced a
			// "Reading additional input from stdin..." stall) — ignore it so the
			// positional task argument is the only prompt source.
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			cwd: options.cwd,
			maxBuffer: BUFFER_SIZE,
			timeout: ENGINE_TIMEOUT_MS,
			reject: false,
		})

		const rl = readline.createInterface({ input: child.stdout })
		const state: ProcessState = { partialData: null, stderrLogs: "" }

		try {
			child.stderr.on("data", (data) => {
				state.stderrLogs += data.toString()
			})

			for await (const line of rl) {
				if (!line.trim()) {
					continue
				}
				const parsed = parseChunk(line, state)
				if (!parsed) {
					continue
				}
				yield* toEngineEvents(parsed)
			}

			if (state.partialData) {
				const salvaged = attemptParse(state.partialData)
				if (salvaged) {
					yield* toEngineEvents(salvaged)
				} else {
					yield { type: "raw", source: "codex", data: state.partialData }
				}
			}

			const result = await child
			if (result.failed) {
				if (result.code === "ENOENT") {
					throw new Error(
						"Failed to find the codex executable. Make sure Codex CLI is installed and on your PATH, " +
							"or set an explicit path in engine settings.",
						{ cause: result },
					)
				}
				const errorOutput = state.stderrLogs?.trim() || result.shortMessage
				yield {
					type: "done",
					success: false,
					summary: `codex engine exited with code ${result.exitCode}.${errorOutput ? ` ${errorOutput}` : ""}`,
				}
			}
		} finally {
			rl.close()
			if (!child.killed) {
				child.kill()
			}
		}
	}

	async capabilities(binaryPath?: string): Promise<AgentEngineCapabilities> {
		const codexPath = binaryPath?.trim() || "codex"
		try {
			const { stdout: version } = await execa(codexPath, ["--version"])
			const helpResult = await execa(codexPath, ["exec", "--help"])
			let subscriptionAuth: boolean | undefined
			try {
				const { stdout } = await execa(codexPath, ["login", "status"])
				subscriptionAuth = stdout.includes("ChatGPT")
			} catch {
				subscriptionAuth = undefined
			}
			return {
				binaryPresent: true,
				version: version.trim(),
				subscriptionAuth,
				// Weak proxy: proves generic -c config-override support exists,
				// not that mcp_servers.* keys specifically work. Codex has no
				// `--mcp-config`-equivalent flag to check for directly.
				supportsMcp: helpResult.stdout.includes("-c, --config"),
				supportsImages: helpResult.stdout.includes("--image"),
			}
		} catch {
			return { binaryPresent: false, supportsMcp: false, supportsImages: false }
		}
	}
}

const SERVER_NAME = "ai-hydro"

function buildArgs(options: AgentEngineRunOptions, serverConfig: AihydroStdioServerConfig): string[] {
	const { sandbox, approvalPolicy } = toCodexSandboxPosture(options.permissionPosture)
	const args = [
		"exec",
		options.task,
		"--json",
		"-c",
		`mcp_servers.${SERVER_NAME}.command=${JSON.stringify(serverConfig.command)}`,
		"--sandbox",
		sandbox,
		"-a",
		approvalPolicy,
		"-C",
		options.cwd,
	]
	if (serverConfig.args?.length) {
		args.push("-c", `mcp_servers.${SERVER_NAME}.args=${JSON.stringify(serverConfig.args)}`)
	}
	if (serverConfig.env && Object.keys(serverConfig.env).length > 0) {
		// `codex mcp add --env KEY=VALUE` confirms per-server env vars are a real
		// part of codex's mcp_servers.* schema; a JSON object is valid TOML
		// inline-table syntax for plain string keys/values like these.
		args.push("-c", `mcp_servers.${SERVER_NAME}.env=${JSON.stringify(serverConfig.env)}`)
	}
	// NOTE — engine-parity gap, not an oversight: the real persisted config
	// (ensureDefaultMcpServer.ts) also carries `cwd` (pins the server process's
	// working directory) and `timeout` (600s, for long-running hydrology tool
	// calls). Unlike claude's --mcp-config file, which round-trips the whole
	// config object, codex has no confirmed `-c mcp_servers.*` key for either —
	// `codex mcp add --help` exposes --env but no --cwd/--timeout equivalent,
	// and this could not be re-verified live (codex CLI unavailable in this
	// sandbox as of this fix). Forwarding `env` covers the practical concern
	// (TMPDIR/TEMP/TMP steer where the server writes cache/temp artifacts),
	// but a real engine-mode run may still be limited by codex's own default
	// per-tool-call timeout. Confirm codex's actual schema before Phase 3 if a
	// long-running tool call needs longer than that default.
	if (options.modelId) {
		args.push("-m", options.modelId)
	}
	return args
}

function parseChunk(data: string, state: ProcessState): Record<string, unknown> | null {
	if (state.partialData) {
		state.partialData += data
		const chunk = attemptParse(state.partialData)
		if (!chunk) {
			return null
		}
		state.partialData = null
		return chunk
	}
	const chunk = attemptParse(data)
	if (!chunk) {
		state.partialData = data
	}
	return chunk
}

function attemptParse(data: string): Record<string, unknown> | null {
	try {
		return JSON.parse(data)
	} catch {
		return null
	}
}

/**
 * Maps codex's observed JSONL vocabulary (thread.x, turn.x, item.x events)
 * to the normalized EngineEvent union. What's actually confirmed against the
 * one live `codex exec ... --json` run on record (scratch/codex-spike-output.jsonl)
 * is narrower than "these shapes are observed" implies:
 *   - field NAMES for turn.completed.usage, and for mcp_tool_call/
 *     command_execution items, are confirmed present.
 *   - only the FAILURE payload of mcp_tool_call (result: null, error: {...})
 *     and only the SUCCESS payload of command_execution (exit_code: 0) were
 *     actually exercised — the opposite branch of each is inferred, not observed.
 *   - a failure-path top-level shape (e.g. a hypothetical "turn.failed") was
 *     never exercised at all; handled defensively by name-pattern only.
 */
function* toEngineEvents(message: Record<string, unknown>): Generator<EngineEvent> {
	const type = message.type as string | undefined

	if (type === "thread.started" || type === "turn.started") {
		return
	}

	if (type === "turn.completed") {
		const usage = (message.usage ?? {}) as Record<string, number>
		yield {
			type: "usage",
			inputTokens: usage.input_tokens ?? 0,
			outputTokens: usage.output_tokens ?? 0,
			cacheReadTokens: usage.cached_input_tokens,
			// codex exec runs on the user's own ChatGPT subscription (see capabilities()); never a metered API key.
			isPaidUsage: false,
		}
		yield { type: "done", success: true }
		return
	}

	// Not observed live — inferred from codex's thread.x/turn.x naming convention.
	if (type === "turn.failed" || type === "error") {
		yield {
			type: "done",
			success: false,
			summary: typeof message.error === "string" ? message.error : JSON.stringify(message.error ?? message),
		}
		return
	}

	if ((type === "item.started" || type === "item.completed") && message.item && typeof message.item === "object") {
		const item = message.item as Record<string, unknown>
		yield* itemToEngineEvents(type, item)
		return
	}

	yield { type: "raw", source: "codex", data: message }
}

function* itemToEngineEvents(
	eventType: "item.started" | "item.completed",
	item: Record<string, unknown>,
): Generator<EngineEvent> {
	const itemType = item.type as string | undefined
	const id = String(item.id ?? "")

	if (itemType === "agent_message") {
		if (eventType === "item.completed" && typeof item.text === "string") {
			yield { type: "text", text: item.text }
		}
		return
	}

	if (itemType === "command_execution") {
		if (eventType === "item.started") {
			yield { type: "tool_use", id, name: "command_execution", input: { command: item.command } }
		} else {
			yield {
				type: "tool_result",
				toolUseId: id,
				content: item.aggregated_output,
				isError: item.status === "failed" || (typeof item.exit_code === "number" && item.exit_code !== 0),
			}
		}
		return
	}

	if (itemType === "mcp_tool_call") {
		// Normalized to claude's mcp__<server>__<tool> naming so downstream
		// UI/ledger consumers see one convention regardless of engine.
		const name = `mcp__${item.server}__${item.tool}`
		if (eventType === "item.started") {
			yield { type: "tool_use", id, name, input: item.arguments }
		} else {
			yield {
				type: "tool_result",
				toolUseId: id,
				content: item.result ?? item.error,
				isError: item.status === "failed" || Boolean(item.error),
			}
		}
		return
	}

	yield { type: "raw", source: "codex", data: item }
}
