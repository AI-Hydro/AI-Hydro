/**
 * The names under which the first-party aihydro-tools MCP server is registered. One host-free definition shared by
 * the extension host (context injection, src/core/task/tools/handlers/aiHydroServer.ts) and the webview (science
 * tool-call cards), so the two cannot drift.
 *
 * `isFirstPartyServerName` identifies by NAME only. It is for DISPLAY and routing (science cards, context
 * injection) and is spoofable: a user-registered server that reuses one of these names matches. It must never
 * gate a security decision. Those use `isServerTrusted` below, the single trust notion shared by claim approval,
 * the explorer profile and any future effect-class policy.
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

/**
 * The launcher recorded host-side when the extension registered the first-party server
 * (src/core/mcp/ensureDefaultMcpServer.ts): the exact `command` and `args` it wrote. First-party trust requires
 * the connection's resolved launch to match this record, so a server that merely reuses the name "ai-hydro"
 * (or a settings entry rewritten to run something else) is not trusted.
 */
export interface FirstPartyLauncher {
	/** Server name the record was made under (exact, case-sensitive). */
	name: string
	command: string
	args: string[]
}

let recordedLauncher: FirstPartyLauncher | undefined

/** Set by the host at startup from the persisted record (and after registration). Never set from tool input. */
export function setRecordedFirstPartyLauncher(launcher: FirstPartyLauncher | undefined): void {
	recordedLauncher = launcher ? { name: launcher.name, command: launcher.command, args: [...launcher.args] } : undefined
}

export function getRecordedFirstPartyLauncher(): FirstPartyLauncher | undefined {
	return recordedLauncher
}

/**
 * Shape test for a first-party launch: `aihydro-mcp` (any directory) or `<python> -m ai_hydro.mcp`. Used only to
 * decide whether an EXISTING registration may be recorded as the launcher; trust itself compares against the
 * record, never against this shape.
 */
export function looksLikeFirstPartyLauncher(command: string, args: readonly string[]): boolean {
	const base = (command.split(/[\\/]/).pop() ?? "").toLowerCase().replace(/\.(exe|cmd|bat)$/, "")
	if (base === "aihydro-mcp") {
		return args.length === 0
	}
	if (/^(python[0-9.]*|py)$/.test(base)) {
		return args.length === 2 && args[0] === "-m" && args[1] === "ai_hydro.mcp"
	}
	return false
}

/** Minimal connection view: McpServer satisfies it (config is the JSON of the validated settings entry). */
export interface ServerConnectionView {
	name: string
	config?: string
}

/**
 * The ONE trust test. A server is trusted iff it is the first-party server: its resolved connection (never a
 * model-supplied name string) is a stdio server whose name AND launch command/args equal the launcher recorded
 * when the extension registered it. Unresolved or unparseable connections are not trusted. Trust is fail-closed:
 * with no record there is no trusted server.
 *
 * Out of scope here: the launcher's `env`/`cwd` are not compared, and a trusted launcher can still load a
 * hostile package from the Python environment it runs in. Trust means "the extension registered this launch
 * line", not "the code is verified".
 */
export function isServerTrusted(
	server: ServerConnectionView | undefined,
	launcher: FirstPartyLauncher | undefined = recordedLauncher,
): boolean {
	if (!server || !launcher || server.name !== launcher.name || !isFirstPartyServerName(server.name)) {
		return false
	}
	let config: unknown
	try {
		config = JSON.parse(server.config ?? "")
	} catch {
		return false
	}
	if (!config || typeof config !== "object") {
		return false
	}
	const { type, command, args } = config as { type?: unknown; command?: unknown; args?: unknown }
	if (type !== "stdio" || typeof command !== "string" || command !== launcher.command) {
		return false
	}
	const actualArgs = args === undefined ? [] : args
	return (
		Array.isArray(actualArgs) &&
		actualArgs.length === launcher.args.length &&
		actualArgs.every((arg, i) => arg === launcher.args[i])
	)
}
