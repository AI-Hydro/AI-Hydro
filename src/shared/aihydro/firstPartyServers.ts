/**
 * The names under which the first-party aihydro-tools MCP server is registered. One host-free definition shared by
 * the extension host (context injection, src/core/task/tools/handlers/aiHydroServer.ts) and the webview (science
 * tool-call cards), so the two cannot drift.
 *
 * Identification is by NAME only. It is weaker than the `_meta` tool-tier test the explorer profile uses, and a
 * user-registered server that reuses one of these names is treated as first-party.
 */
export const FIRST_PARTY_SERVER_NAMES: ReadonlySet<string> = new Set([
	"ai-hydro",
	"aihydro",
	"aihydro-tools",
	"ai-hydro-tools",
	"aihydro_tools",
])

export function isFirstPartyServerName(serverName: string | undefined): boolean {
	return FIRST_PARTY_SERVER_NAMES.has((serverName ?? "").trim().toLowerCase())
}
