import { execa } from "execa"
import readline from "readline"
import { toClaudePermissionMode } from "./permission-posture"
import type { AgentEngine, AgentEngineCapabilities, AgentEngineRunOptions, EngineEvent } from "./types"

const ENGINE_TIMEOUT_MS = 1_800_000 // 30 minutes — an autonomous multi-tool-call task runs far longer than the 1-turn model-pipe.
// https://github.com/sindresorhus/execa/blob/main/docs/api.md#optionsmaxbuffer
const BUFFER_SIZE = 20_000_000 // 20 MB

type ProcessState = {
	partialData: string | null
	stderrLogs: string
	isPaidUsage: boolean
}

/**
 * Drives `claude` as an autonomous agent engine: its OWN tool loop, with the
 * aihydro-mcp server attached, rather than the single-turn "model pipe" mode
 * used by src/integrations/claude-code/run.ts (--max-turns 1,
 * --disallowedTools). That existing pipe is left untouched as a fallback.
 */
export class ClaudeCodeEngine implements AgentEngine {
	readonly id = "claude-code" as const

	async *run(options: AgentEngineRunOptions): AsyncGenerator<EngineEvent> {
		const binaryPath = options.binaryPath?.trim() || "claude"
		const args = buildArgs(options)

		const env: NodeJS.ProcessEnv = { ...process.env }
		// Never consume the user's metered ANTHROPIC_API_KEY — let claude resolve
		// its own subscription auth, mirroring the existing model-pipe provider.
		delete env["ANTHROPIC_API_KEY"]

		const child = execa(binaryPath, args, {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			env,
			cwd: options.cwd,
			maxBuffer: BUFFER_SIZE,
			timeout: ENGINE_TIMEOUT_MS,
			// execa rejects on non-zero exit by default; we want to resolve so
			// the exitCode branch below can yield a normalized `done: false`
			// event instead of throwing an uncaught ExecaError.
			reject: false,
		})

		const rl = readline.createInterface({ input: child.stdout })
		const state: ProcessState = { partialData: null, stderrLogs: "", isPaidUsage: true }

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
				yield* toEngineEvents(parsed, state)
			}

			// The stream can end mid-message (e.g. truncated output); surface
			// whatever fragment remains rather than silently losing it, mirroring
			// run.ts's salvage of a truncated trailing assistant message.
			if (state.partialData) {
				const salvaged = attemptParse(state.partialData)
				if (salvaged) {
					yield* toEngineEvents(salvaged, state)
				} else {
					yield { type: "raw", source: "claude-code", data: state.partialData }
				}
			}

			// With `reject: false`, execa resolves (never rejects) on both a
			// spawn failure and a non-zero exit — the resolved result's own
			// `failed`/`code`/`exitCode` fields are the authoritative signal,
			// not the "error"/"close" events (which race an empty/instantly-
			// resolving stdout stream and can't be relied on for control flow).
			const result = await child
			if (result.failed) {
				if (result.code === "ENOENT") {
					throw new Error(
						"Failed to find the claude executable. Make sure Claude Code is installed and on your PATH, " +
							"or set an explicit path in engine settings.",
						{ cause: result },
					)
				}
				const errorOutput = state.stderrLogs?.trim() || result.shortMessage
				yield {
					type: "done",
					success: false,
					summary: `claude engine exited with code ${result.exitCode}.${errorOutput ? ` ${errorOutput}` : ""}`,
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
		const claudePath = binaryPath?.trim() || "claude"
		try {
			const { stdout } = await execa(claudePath, ["--version"])
			const helpResult = await execa(claudePath, ["--help"])
			return {
				binaryPresent: true,
				version: stdout.trim(),
				supportsMcp: helpResult.stdout.includes("--mcp-config"),
				supportsImages: false,
			}
		} catch {
			return { binaryPresent: false, supportsMcp: false, supportsImages: false }
		}
	}
}

function buildArgs(options: AgentEngineRunOptions): string[] {
	const args = [
		"-p",
		options.task,
		"--verbose",
		"--output-format",
		"stream-json",
		"--mcp-config",
		options.mcpConfigPath,
		"--strict-mcp-config",
		"--permission-mode",
		toClaudePermissionMode(options.permissionPosture),
		"--add-dir",
		options.cwd,
	]
	if (options.modelId) {
		args.push("--model", options.modelId)
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

function* toEngineEvents(message: Record<string, unknown>, state: ProcessState): Generator<EngineEvent> {
	const type = message.type as string | undefined

	if (type === "system" && message.subtype === "init") {
		// Subscription usage sets apiKeySource to "none"; a metered key or a
		// managed-key helper path indicate the CLI resolved its own auth.
		state.isPaidUsage = message.apiKeySource !== "none"
		return
	}

	if (type === "assistant" && message.message && typeof message.message === "object") {
		const content = (message.message as { content?: unknown[] }).content ?? []
		for (const block of content) {
			const b = block as Record<string, unknown>
			if (b.type === "text" && typeof b.text === "string") {
				yield { type: "text", text: b.text }
			} else if ((b.type === "thinking" || b.type === "redacted_thinking") && typeof b.thinking === "string") {
				yield { type: "reasoning", text: b.thinking }
			} else if (b.type === "tool_use") {
				yield { type: "tool_use", id: String(b.id), name: String(b.name), input: b.input }
			}
		}
		return
	}

	if (type === "user" && message.message && typeof message.message === "object") {
		const content = (message.message as { content?: unknown[] }).content ?? []
		for (const block of content) {
			const b = block as Record<string, unknown>
			if (b.type === "tool_result") {
				yield {
					type: "tool_result",
					toolUseId: String(b.tool_use_id),
					content: b.content,
					isError: Boolean(b.is_error),
				}
			}
		}
		return
	}

	if (type === "result") {
		const isError = Boolean(message.is_error)
		yield {
			type: "usage",
			inputTokens: 0,
			outputTokens: 0,
			totalCostUsd: typeof message.total_cost_usd === "number" ? message.total_cost_usd : undefined,
			isPaidUsage: state.isPaidUsage,
		}
		yield { type: "done", success: !isError, summary: typeof message.result === "string" ? message.result : undefined }
		return
	}

	// Unknown/unmapped shape: surface rather than silently drop.
	yield { type: "raw", source: "claude-code", data: message }
}
