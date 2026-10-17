/**
 * Pure helpers for identifying ai-hydro MCP servers. Kept dependency-free so it
 * can be unit-tested without dragging in the full tool-handler import chain
 * (telemetry, host providers, etc.).
 */

/** Names the extension itself registers for the first-party aihydro-tools server. */
const FIRST_PARTY_SERVER_NAMES = new Set(["ai-hydro", "aihydro", "aihydro-tools", "ai-hydro-tools", "aihydro_tools"])

/** Extra trusted names, comma separated, for users who register the server under another alias. */
export const TRUSTED_SERVER_ENV = "AIHYDRO_TRUSTED_MCP_SERVERS"

/**
 * Whether an MCP server is the first-party ai-hydro server, for which the extension
 * injects `_chat_id` + `_workspace` (and `_meta["aihydro/context"]`) so the Python session
 * resolver can bind this chat to a study and auto-resolve the workspace for file outputs.
 *
 * A strict `=== "ai-hydro"` check silently disabled chat-study binding for the aliases the
 * server is registered under, but a prefix regex also sent the workspace path and chat id to
 * any third-party server whose name merely started with "aihydro". So: an explicit set of
 * first-party names, plus an explicit user allowlist (`extraTrusted`, defaulting to the
 * AIHYDRO_TRUSTED_MCP_SERVERS environment variable).
 */
export function isAiHydroServerName(
	serverName: string | undefined,
	extraTrusted: string[] = (process.env[TRUSTED_SERVER_ENV] ?? "").split(","),
): boolean {
	const name = serverName?.trim().toLowerCase()
	if (!name) {
		return false
	}
	if (FIRST_PARTY_SERVER_NAMES.has(name)) {
		return true
	}
	return extraTrusted.some((entry) => entry.trim().toLowerCase() === name)
}
