/**
 * Pure helpers for identifying ai-hydro MCP servers. Kept dependency-free so it
 * can be unit-tested without dragging in the full tool-handler import chain
 * (telemetry, host providers, etc.).
 */

import { FIRST_PARTY_SERVER_NAMES } from "@shared/aihydro/firstPartyServers"

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

/** The tool `_meta` key the first-party server sets on tools meant for the host application, not the agent. */
export const AUDIENCE_META_KEY = "aihydro/audience"

/**
 * Whether the model may not call this tool: it is on a first-party AI-Hydro server and the server's own annotation
 * (`_meta["aihydro/audience"] === "host"`) marks it for the host. The server hides such tools from discovery but does
 * not enforce the flag; the host does, here, before approval and before the call. Keyed off the annotation, never off
 * a tool name, so a new host operation is covered without a change. A tool the server does not list is not judged
 * here (the unknown-tool check handles it).
 */
export function isHostAudienceTool(
	connections: Array<{ server: { name: string; tools?: Array<{ name: string; _meta?: Record<string, any> }> } }> | undefined,
	serverName: string,
	toolName: string,
): boolean {
	if (!isAiHydroServerName(serverName)) {
		return false
	}
	const tool = connections?.find((c) => c.server.name === serverName)?.server.tools?.find((t) => t.name === toolName)
	return tool?._meta?.[AUDIENCE_META_KEY] === "host"
}

export function hostAudienceRefusal(toolName: string): string {
	return `'${toolName}' is a host operation: the AI-Hydro extension performs it itself, so the agent cannot call it. Use the study and project tools that are listed for you instead.`
}
