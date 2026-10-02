/**
 * Normalized event/interface contract for driving a flagship CLI as an
 * autonomous agent engine (as opposed to the single-turn "model pipe" mode
 * used by src/integrations/claude-code/run.ts).
 *
 * Every concrete engine (ClaudeCodeEngine, CodexEngine, ...) translates its
 * own native stream-json / JSONL vocabulary into this union so the rest of
 * AI-Hydro (task loop, UI event stream, defensibility middleware) only ever
 * has to understand one shape.
 */

export type EngineEvent =
	| { type: "text"; text: string }
	| { type: "reasoning"; text: string }
	| { type: "tool_use"; id: string; name: string; input: unknown }
	| { type: "tool_result"; toolUseId: string; content: unknown; isError?: boolean }
	| { type: "file_edit"; path: string; description?: string }
	| {
			type: "usage"
			inputTokens: number
			outputTokens: number
			cacheReadTokens?: number
			cacheWriteTokens?: number
			totalCostUsd?: number
			/** True when billed as metered per-token API usage; false for flat-rate subscription auth. */
			isPaidUsage: boolean
	  }
	| { type: "done"; success: boolean; summary?: string }
	| { type: "raw"; source: "claude-code" | "codex"; data: unknown }

/**
 * Least-privilege permission posture, expressed independently of which CLI
 * ultimately consumes it. Concrete engines map this to their own flags
 * (claude: --permission-mode; codex: --sandbox + --ask-for-approval).
 *
 * "scoped-write" is the default: file writes are allowed but confined to
 * `cwd`; no interactive approval prompts (the engine runs headless), and no
 * bypass of sandboxing. Never widen this default silently.
 */
export type PermissionPosture = "read-only" | "scoped-write"

export interface AgentEngineRunOptions {
	/** Natural-language task description; the engine runs its own loop. */
	task: string
	/**
	 * Path to a stdio MCP config JSON (see mcp-config.ts's writeEngineMcpConfig)
	 * attaching aihydro-mcp. Required by ClaudeCodeEngine, which has no other
	 * way to attach an MCP server. CodexEngine ignores this field entirely —
	 * it has no --mcp-config-equivalent flag, so it resolves the same
	 * aihydro-mcp config itself via mcp-config.ts's readAihydroServerConfig
	 * and constructs `-c mcp_servers.*` overrides directly. A future caller
	 * driving both engines should skip calling writeEngineMcpConfig for a
	 * codex run — it would be a wasted temp-file write.
	 */
	mcpConfigPath: string
	/** Working root the engine may read/write within. */
	cwd: string
	permissionPosture: PermissionPosture
	/** Optional path to the CLI binary; defaults to the bare command on PATH. */
	binaryPath?: string
	modelId?: string
}

export interface AgentEngineCapabilities {
	binaryPresent: boolean
	version?: string
	/** True when auth resolves to the user's own subscription, not a metered API key. */
	subscriptionAuth?: boolean
	supportsMcp: boolean
	supportsImages: boolean
}

export interface AgentEngine {
	readonly id: "claude-code" | "codex"
	run(options: AgentEngineRunOptions): AsyncGenerator<EngineEvent>
	/** binaryPath should match whatever run() will be called with, so the probe reflects the binary actually used. */
	capabilities(binaryPath?: string): Promise<AgentEngineCapabilities>
}
