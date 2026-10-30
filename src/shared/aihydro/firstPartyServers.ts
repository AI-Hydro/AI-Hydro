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
	/**
	 * Hash of the launch CONTEXT the extension registered: the entry's `env` and `cwd` (see `launchContextHash`).
	 * `PYTHONPATH`/`PATH` in `env` or a different `cwd` change what the same command line actually runs, so they are
	 * part of the identity. It covers ONLY the entry's own `env` and `cwd`: a PATH inherited from the process
	 * environment is not hashed, so a bare command is resolved by the host's PATH at launch. A record written before this field existed has none and is read as the EMPTY context:
	 * an entry that carries env/cwd then fails toward a human confirmation, never a silent adoption.
	 */
	launchHash?: string
}

let recordedLauncher: FirstPartyLauncher | undefined

/** Set by the host at startup from the persisted record (and after registration). Never set from tool input. */
export function setRecordedFirstPartyLauncher(launcher: FirstPartyLauncher | undefined): void {
	recordedLauncher = launcher
		? { name: launcher.name, command: launcher.command, args: [...launcher.args], launchHash: launcher.launchHash }
		: undefined
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

// ── Launch context identity ─────────────────────────────────────────────────

const SHA256_K = [
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
	0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
	0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
	0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
	0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
	0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

/** Host-free SHA-256 (this module is bundled into the webview too, so it cannot import node:crypto). */
export function sha256Hex(input: string): string {
	const bytes: number[] = Array.from(new TextEncoder().encode(input))
	const bitLen = bytes.length * 8
	bytes.push(0x80)
	while (bytes.length % 64 !== 56) {
		bytes.push(0)
	}
	const hi = Math.floor(bitLen / 0x100000000)
	const lo = bitLen >>> 0
	for (const w of [hi, lo]) {
		bytes.push((w >>> 24) & 0xff, (w >>> 16) & 0xff, (w >>> 8) & 0xff, w & 0xff)
	}
	const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
	const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
	for (let off = 0; off < bytes.length; off += 64) {
		const w = new Array<number>(64)
		for (let i = 0; i < 16; i++) {
			w[i] =
				(bytes[off + i * 4] << 24) |
				(bytes[off + i * 4 + 1] << 16) |
				(bytes[off + i * 4 + 2] << 8) |
				bytes[off + i * 4 + 3]
		}
		for (let i = 16; i < 64; i++) {
			const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
			const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
			w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
		}
		let [a, b, c, d, e, f, g, hh] = h
		for (let i = 0; i < 64; i++) {
			const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
			const ch = (e & f) ^ (~e & g)
			const t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) | 0
			const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
			const maj = (a & b) ^ (a & c) ^ (b & c)
			const t2 = (S0 + maj) | 0
			hh = g
			g = f
			f = e
			e = (d + t1) | 0
			d = c
			c = b
			b = a
			a = (t1 + t2) | 0
		}
		h[0] = (h[0] + a) | 0
		h[1] = (h[1] + b) | 0
		h[2] = (h[2] + c) | 0
		h[3] = (h[3] + d) | 0
		h[4] = (h[4] + e) | 0
		h[5] = (h[5] + f) | 0
		h[6] = (h[6] + g) | 0
		h[7] = (h[7] + hh) | 0
	}
	return h.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("")
}

/**
 * Identity of a launch's environment: a hash of `env` (sorted by key; non-string values mark the entry as
 * different, never skipped) and `cwd`. Env values can hold secrets, so only the hash is ever persisted.
 */
export function launchContextHash(entry: { env?: unknown; cwd?: unknown }): string {
	const env = entry.env
	let envPairs: Array<[string, unknown]> = []
	if (env && typeof env === "object" && !Array.isArray(env)) {
		envPairs = Object.entries(env as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
	} else if (env !== undefined) {
		envPairs = [["<invalid-env>", String(env)]]
	}
	const cwd = typeof entry.cwd === "string" ? entry.cwd : entry.cwd === undefined ? null : `<invalid-cwd:${String(entry.cwd)}>`
	return sha256Hex(JSON.stringify({ env: envPairs, cwd }))
}

export const EMPTY_LAUNCH_HASH = launchContextHash({})

/** The context hash a record stands for (a record without one is the empty context). */
export function recordedLaunchHash(launcher: FirstPartyLauncher): string {
	return launcher.launchHash ?? EMPTY_LAUNCH_HASH
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
	| "env_or_cwd_differs"

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
	if (launchContextHash(config as { env?: unknown; cwd?: unknown }) !== recordedLaunchHash(launcher)) {
		return { trusted: false, failure: "env_or_cwd_differs", config }
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

/** The `command args` line a connection config launches, for display (never for a decision). Empty when unreadable. */
export function launchLineOfConfig(config: string | undefined): string {
	try {
		const { command, args } = JSON.parse(config ?? "") as { command?: unknown; args?: unknown }
		if (typeof command !== "string" || !command) {
			return ""
		}
		const rest = Array.isArray(args) ? args.filter((a): a is string => typeof a === "string") : []
		return [command, ...rest].join(" ")
	} catch {
		return ""
	}
}

/** Plain-language state of a first-party launcher the user has not confirmed. `launchLine` is shown verbatim. */
export function newLauncherSentence(launchLine: string): string {
	return launchLine
		? `AI-Hydro Tools is running from a new location (\`${launchLine}\`). Your auto-run settings are paused until you confirm it.`
		: "AI-Hydro Tools is running from a location you have not confirmed. Your auto-run settings are paused until you confirm it."
}

/**
 * Whether the "Trust this launcher..." action fits a server: it is first-party by name, so confirming the launcher
 * AI-Hydro found can make it trusted. A third-party server never gets the action (it can never be first-party).
 */
export function canOfferTrustAction(serverName: string | undefined): boolean {
	return isFirstPartyServerName(serverName)
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
					? "Not trusted: you have not confirmed an AI-Hydro Tools launcher yet. Auto-run is paused until you do (Trust this launcher...)."
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
				reason: shaped
					? `Not trusted: ${newLauncherSentence(launchLineOfConfig(server.config))}`
					: `Not trusted: the launcher you confirmed belongs to a server named '${launcher?.name}', not '${server.name}'.`,
			}
		}
		case "config_unreadable":
			return { trusted: false, reason: "Not trusted: its settings entry could not be read." }
		case "not_stdio":
			return { trusted: false, reason: "Not trusted: first-party trust requires a local stdio launch, not a remote URL." }
		case "env_or_cwd_differs":
			return {
				trusted: false,
				reason: "Not trusted: AI-Hydro Tools now runs with different environment variables or a different working directory than the launcher you confirmed. Your auto-run settings are paused until you confirm it (Trust this launcher...).",
			}
		case "launch_differs":
			return {
				trusted: false,
				reason: `Not trusted: ${newLauncherSentence(launchLineOfConfig(server.config))}`,
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
	env?: unknown
	cwd?: unknown
}

export type FirstPartyAnchorPlan =
	/** Nothing to do (recorded server is enabled, or no candidate). `reason` is for logs and tests. */
	| { action: "none"; reason: string }
	/** Same launch line as the verified record, only the server name changed: re-record under the new name. */
	| { action: "rename"; candidate: SettingsServerEntry & { command: string; args: string[]; launchHash: string } }
	/** Different launch line with the first-party shape: ask the human before re-recording. */
	| { action: "confirm"; candidate: SettingsServerEntry & { command: string; args: string[]; launchHash: string } }
	/** More than one enabled first-party-shaped server: never pick one. */
	| { action: "ambiguous"; candidates: string[] }

/** `disabled` as the settings schema reads it (z.boolean().optional()): undefined/false = enabled, true = disabled. */
function enabledState(entry: SettingsServerEntry): "enabled" | "disabled" | "invalid" {
	if (entry.disabled === undefined || entry.disabled === false) {
		return "enabled"
	}
	return entry.disabled === true ? "disabled" : "invalid"
}

function entryLaunch(entry: SettingsServerEntry): { command: string; args: string[]; launchHash: string } | undefined {
	if (typeof entry.command !== "string") {
		return undefined
	}
	const args = entry.args === undefined ? [] : entry.args
	if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) {
		return undefined
	}
	return { command: entry.command, args: args as string[], launchHash: launchContextHash(entry) }
}

/**
 * Migration plan for the trust anchor (session study S6). Situation: the recorded launcher names a server that is
 * disabled or gone, while an enabled server under a different first-party name is the one in use, so the working
 * server is untrusted and its instructions never reach the model.
 *
 * Safety rules (this never trusts by name alone, and never widens trust silently):
 *  - Acts only when the recorded server is NOT enabled in settings (otherwise the existing reconcile owns it).
 *  - Candidates are ENABLED stdio entries under a first-party NAME whose launch line has the first-party SHAPE.
 *    Exactly one candidate is required; two or more is `ambiguous` and nothing changes. An entry whose `disabled`
 *    is not a boolean is invalid under the settings schema and counts as neither enabled nor a candidate.
 *  - Silent re-record only when the candidate's command, args AND launch context (env + cwd hash) are IDENTICAL to
 *    the verified record (the same launch the extension already trusted, under another name). Any other launch,
 *    including a record that predates the context hash, needs the human.
 *  - With no record at all it still asks (`confirm`), never records silently.
 */
export function planFirstPartyAnchor(
	entries: readonly SettingsServerEntry[],
	recorded: FirstPartyLauncher | undefined,
): FirstPartyAnchorPlan {
	const enabled = entries.filter((e) => enabledState(e) === "enabled")
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
		recorded.args.every((a, i) => a === launch.args[i]) &&
		recordedLaunchHash(recorded) === launch.launchHash
	return sameLaunchAsRecord ? { action: "rename", candidate: withLaunch } : { action: "confirm", candidate: withLaunch }
}

/** The recorded launcher belongs to a server that is disabled or gone, while one enabled first-party server is in use. */
export interface StaleFirstPartyAnchor {
	recordedName: string
	state: "disabled" | "removed"
	/** The enabled first-party-shaped server that is in use instead. */
	activeName: string
}

/**
 * Display-only companion of `planFirstPartyAnchor`: names the stale record so the status chip and the confirmation
 * can say "Previously trusted: ai-hydro (disabled)". It never changes trust; the confirmation click is still required.
 * Undefined unless there is a record, it is not enabled, and exactly one enabled first-party candidate exists.
 */
export function describeStaleAnchor(
	entries: readonly SettingsServerEntry[],
	recorded: FirstPartyLauncher | undefined,
): StaleFirstPartyAnchor | undefined {
	if (!recorded) {
		return undefined
	}
	const plan = planFirstPartyAnchor(entries, recorded)
	if (plan.action !== "rename" && plan.action !== "confirm") {
		return undefined
	}
	const stored = entries.some((e) => e.name === recorded.name)
	return { recordedName: recorded.name, state: stored ? "disabled" : "removed", activeName: plan.candidate.name }
}

export function staleAnchorNote(stale: StaleFirstPartyAnchor): string {
	return `Previously trusted: ${stale.recordedName} (${stale.state}).`
}
