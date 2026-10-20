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

type TrustFailure =
	| "no_server"
	| "no_record"
	| "not_first_party_name"
	| "name_differs_from_record"
	| "config_unreadable"
	| "not_stdio"
	| "launch_differs"

type TrustEvaluation = { trusted: true } | { trusted: false; failure: TrustFailure; config?: unknown }

function evaluateServerTrust(
	server: ServerConnectionView | undefined,
	launcher: FirstPartyLauncher | undefined,
): TrustEvaluation {
	if (!server) {
		return { trusted: false, failure: "no_server" }
	}
	if (!launcher) {
		return { trusted: false, failure: "no_record" }
	}
	if (!isFirstPartyServerName(server.name)) {
		return { trusted: false, failure: "not_first_party_name" }
	}
	if (server.name !== launcher.name) {
		return { trusted: false, failure: "name_differs_from_record" }
	}
	let config: unknown
	try {
		config = JSON.parse(server.config ?? "")
	} catch {
		return { trusted: false, failure: "config_unreadable" }
	}
	if (!config || typeof config !== "object") {
		return { trusted: false, failure: "config_unreadable" }
	}
	const { type, command, args } = config as { type?: unknown; command?: unknown; args?: unknown }
	if (type !== "stdio") {
		return { trusted: false, failure: "not_stdio", config }
	}
	const actualArgs = args === undefined ? [] : args
	if (
		typeof command !== "string" ||
		command !== launcher.command ||
		!Array.isArray(actualArgs) ||
		actualArgs.length !== launcher.args.length ||
		!actualArgs.every((arg, i) => arg === launcher.args[i])
	) {
		return { trusted: false, failure: "launch_differs", config }
	}
	return { trusted: true }
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
	return evaluateServerTrust(server, launcher).trusted
}

/** What the MCP servers UI shows for a server: the verdict of `isServerTrusted`, and why. Display only. */
export interface ServerTrustExplanation {
	trusted: boolean
	reason: string
}

/** Peer view used to point at a first-party-shaped sibling (never changes the verdict). */
export interface ServerPeerView extends ServerConnectionView {
	disabled?: boolean
}

function configLooksFirstParty(config: unknown): boolean {
	const { type, command, args } = (config ?? {}) as { type?: unknown; command?: unknown; args?: unknown }
	return (
		type === "stdio" &&
		typeof command === "string" &&
		Array.isArray(args ?? []) &&
		looksLikeFirstPartyLauncher(command, (args ?? []) as string[])
	)
}

/**
 * Human-readable trust state, derived from the same evaluation as `isServerTrusted` (so the UI can never
 * disagree with the security decision). Reasons name what to do, never imply an unverified server is safe.
 */
export function explainServerTrust(
	server: ServerPeerView,
	launcher: FirstPartyLauncher | undefined = recordedLauncher,
): ServerTrustExplanation {
	const result = evaluateServerTrust(server, launcher)
	if (result.trusted) {
		return {
			trusted: true,
			reason: "Trusted: its launch line matches the launcher AI-Hydro recorded, so its instructions are sent to the model.",
		}
	}
	switch (result.failure) {
		case "not_first_party_name":
			return {
				trusted: false,
				reason: "Not trusted: third-party server. It gets no first-party privileges and its instructions are not sent to the model.",
			}
		case "no_record":
			return {
				trusted: false,
				reason: isFirstPartyServerName(server.name)
					? "Not trusted: no first-party launcher is recorded yet. Restart AI-Hydro to record or review it."
					: "Not trusted: third-party server. It gets no first-party privileges and its instructions are not sent to the model.",
			}
		case "name_differs_from_record": {
			let shaped = false
			try {
				shaped = !server.disabled && configLooksFirstParty(JSON.parse(server.config ?? ""))
			} catch {
				shaped = false
			}
			return {
				trusted: false,
				reason:
					`Not trusted: the recorded first-party launcher belongs to a server named '${launcher?.name}', not '${server.name}'.` +
					(shaped
						? " This server's launch line has the first-party shape: restart AI-Hydro to review it and, if you agree, record it."
						: ""),
			}
		}
		case "config_unreadable":
			return { trusted: false, reason: "Not trusted: its settings entry could not be read." }
		case "not_stdio":
			return { trusted: false, reason: "Not trusted: first-party trust requires a local stdio launch, not a remote URL." }
		case "launch_differs":
			return {
				trusted: false,
				reason: "Not trusted: its launch command differs from the recorded launcher. Restart AI-Hydro to review the change.",
			}
		case "no_server":
		default:
			return { trusted: false, reason: "Not trusted: server not resolved." }
	}
}

/** A settings entry as stored in cline_mcp_settings.json (only the fields trust cares about). */
export interface SettingsServerEntry {
	name: string
	type?: unknown
	command?: unknown
	args?: unknown
	disabled?: unknown
}

export type FirstPartyAnchorPlan =
	/** Nothing to do (recorded server is enabled, or no candidate). `reason` is for logs and tests. */
	| { action: "none"; reason: string }
	/** Same launch line as the verified record, only the server name changed: re-record under the new name. */
	| { action: "rename"; candidate: SettingsServerEntry & { command: string; args: string[] } }
	/** Different launch line with the first-party shape: ask the human before re-recording. */
	| { action: "confirm"; candidate: SettingsServerEntry & { command: string; args: string[] } }
	/** More than one enabled first-party-shaped server: never pick one. */
	| { action: "ambiguous"; candidates: string[] }

function entryLaunch(entry: SettingsServerEntry): { command: string; args: string[] } | undefined {
	if (typeof entry.command !== "string") {
		return undefined
	}
	const args = entry.args === undefined ? [] : entry.args
	if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) {
		return undefined
	}
	return { command: entry.command, args: args as string[] }
}

/**
 * Migration plan for the trust anchor (session study S6). Situation: the recorded launcher names a server that is
 * disabled or gone, while an enabled server under a different first-party name is the one in use, so the working
 * server is untrusted and its instructions never reach the model.
 *
 * Safety rules (this never trusts by name alone, and never widens trust silently):
 *  - Acts only when the recorded server is NOT enabled in settings (otherwise the existing reconcile owns it).
 *  - Candidates are ENABLED stdio entries under a first-party NAME whose launch line has the first-party SHAPE.
 *    Exactly one candidate is required; two or more is `ambiguous` and nothing changes.
 *  - Silent re-record only when the candidate's command and args are IDENTICAL to the verified record (the same
 *    launch line the extension already trusted, under another name). Any other launch line needs the human.
 *  - With no record at all it still asks (`confirm`), never records silently.
 */
export function planFirstPartyAnchor(
	entries: readonly SettingsServerEntry[],
	recorded: FirstPartyLauncher | undefined,
): FirstPartyAnchorPlan {
	const enabled = entries.filter((e) => e.disabled !== true)
	if (recorded && enabled.some((e) => e.name === recorded.name)) {
		return { action: "none", reason: "recorded server is enabled" }
	}
	const candidates = enabled.filter((e) => {
		const launch = entryLaunch(e)
		return (
			isFirstPartyServerName(e.name) &&
			(e.type === undefined || e.type === "stdio") &&
			launch !== undefined &&
			looksLikeFirstPartyLauncher(launch.command, launch.args)
		)
	})
	if (candidates.length === 0) {
		return { action: "none", reason: "no enabled first-party-shaped server" }
	}
	if (candidates.length > 1) {
		return { action: "ambiguous", candidates: candidates.map((c) => c.name) }
	}
	const candidate = candidates[0]
	const launch = entryLaunch(candidate)!
	const withLaunch = { ...candidate, ...launch }
	const sameLaunchAsRecord =
		recorded !== undefined &&
		recorded.command === launch.command &&
		recorded.args.length === launch.args.length &&
		recorded.args.every((a, i) => a === launch.args[i])
	return sameLaunchAsRecord ? { action: "rename", candidate: withLaunch } : { action: "confirm", candidate: withLaunch }
}
