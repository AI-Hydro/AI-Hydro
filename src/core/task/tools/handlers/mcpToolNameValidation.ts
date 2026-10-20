/**
 * Pre-approval validation of the `use_mcp_tool` target. A model that names a tool its server does not expose
 * (e.g. a built-in tool name addressed to an MCP server) must get a structured, actionable error WITHOUT the
 * user being asked to approve a call that cannot succeed.
 *
 * Never guesses: when a server's tool list is not known (undefined, or the server is not connected), validation is skipped and the normal
 * approval flow runs.
 */

export interface McpConnectionLike {
	server: { name: string; status?: string; tools?: Array<{ name: string }> }
}

export type McpToolNameCheck =
	| { ok: true }
	| { ok: false; reason: "unknown_server" | "unknown_tool"; message: string; suggestions: string[] }

const MAX_SUGGESTIONS = 5

function editDistance(a: string, b: string): number {
	const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
	for (let i = 1; i <= a.length; i++) {
		let diag = prev[0]
		prev[0] = i
		for (let j = 1; j <= b.length; j++) {
			const tmp = prev[j]
			prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
			diag = tmp
		}
	}
	return prev[b.length]
}

/** Up to `limit` candidate names closest to `wanted` (substring/prefix matches first, then edit distance). */
export function closestNames(wanted: string, candidates: string[], limit = MAX_SUGGESTIONS): string[] {
	const w = wanted.toLowerCase()
	return [...candidates]
		.map((name) => {
			const n = name.toLowerCase()
			const related = n.includes(w) || w.includes(n) || n.startsWith(w.slice(0, 4))
			return { name, score: (related ? 0 : 1000) + editDistance(w, n) }
		})
		.sort((x, y) => x.score - y.score || x.name.localeCompare(y.name))
		.slice(0, limit)
		.map((c) => c.name)
}

export function checkMcpToolName(
	connections: McpConnectionLike[] | undefined,
	serverName: string,
	toolName: string,
): McpToolNameCheck {
	if (!connections) {
		return { ok: true }
	}
	const connection = connections.find((c) => c.server.name === serverName)
	if (!connection) {
		// List only servers that are actually usable now; a disconnected one would be a misleading suggestion.
		const servers = connections.filter((c) => c.server.status === "connected").map((c) => c.server.name)
		const suggestions = closestNames(serverName, servers)
		return {
			ok: false,
			reason: "unknown_server",
			suggestions,
			message: `MCP server '${serverName}' is not connected. Connected servers: ${servers.length ? servers.join(", ") : "(none)"}. Nothing was run and the user was not asked.`,
		}
	}
	// Validate only against a list we KNOW: a server that is not connected, or whose tools/list failed (the host
	// stores `undefined` for that), is not evidence that the tool is missing. The normal call path reports it.
	const tools = connection.server.tools
	if (connection.server.status !== undefined && connection.server.status !== "connected") {
		return { ok: true }
	}
	if (!Array.isArray(tools)) {
		return { ok: true }
	}
	if (tools.some((t) => t.name === toolName)) {
		return { ok: true }
	}
	const names = tools.map((t) => t.name)
	const suggestions = closestNames(toolName, names)
	return {
		ok: false,
		reason: "unknown_tool",
		suggestions,
		message:
			`Tool '${toolName}' does not exist on MCP server '${serverName}' (${names.length} tools). ` +
			(suggestions.length ? `Closest names: ${suggestions.join(", ")}. ` : "") +
			"Nothing was run and the user was not asked. If you meant a built-in tool (for example ask_followup_question), call it directly instead of through use_mcp_tool.",
	}
}
