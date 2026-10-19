/**
 * Host-side command policy for `execute_command` (approval redesign AP1, findings B1, B2, B3 and the
 * protected-command rule). Pure and dependency-free so it can be unit-tested without the task stack.
 *
 * Three independent mechanisms, none of which trusts the model:
 *
 *  1. matchProtectedCommand: the claim-approval CLI is HARD DENIED, whatever YOLO or auto-run settings say.
 *  2. classifyCommand: a conservative allowlist decides which commands are READ-ONLY. A command may auto-run
 *     under "Run read-only commands" only if this classifier says so. The model's `requires_approval` flag can
 *     only make a command stricter, never looser.
 *  3. commandMentionsProtectedPath: commands that mention protected state (MCP settings, extension storage,
 *     $AIHYDRO_HOME/{approvals,trust,registry}, ~/.ssh) always ask.
 *
 * What this CANNOT do (stated here, in the plan doc and in the user docs, because it is easy to over-trust):
 *  - It matches TEXT. Indirection defeats it: `a=aihydro-; ${a}approve`, `$'\x61ihydro-approve'`, a script file
 *    written earlier and run later, a base64-decoded payload, a program that spawns another program, or a
 *    subagent that decides on its own. A same-user process can always bypass a text matcher.
 *  - The read-only classifier is a filter, not a sandbox. It only knows the programs listed below; it does not
 *    know what a hostile file, alias, git config or PATH entry makes those programs do.
 * The second line of defence for claim approval is the CLI's own refusal in an agent-marked context
 * (AIHYDRO_AGENT_CONTEXT); the real boundary is a touch-required (sk-) signature. See
 * plans/approval-redesign-ap1-2026-10-19.md.
 */

import { classifyCommand, type ShellEnvironment } from "./readOnlyClassifier"

// ---------------------------------------------------------------------------------------------------------------
// 1. Protected commands (hard deny)
// ---------------------------------------------------------------------------------------------------------------

const PROTECTED_COMMAND_SUBSTRINGS = ["aihydro-approve", "ai_hydro.approval", "ai_hydro/approval"] as const
/** `from ai_hydro import approval` style imports: the dotted name never appears, so match the shape. */
const PROTECTED_IMPORT_PATTERN = /ai_hydro\s+import\s[^\n;|&]*\bapproval\b/

export const PROTECTED_COMMAND_DENY_MESSAGE =
	"Blocked by AI-Hydro: this command touches claim approval. Claim approval must be given by you, in your own " +
	"terminal (outside the agent): run `aihydro-approve <session> <claim>` yourself, or use the 'Approve in terminal' " +
	"notification. No auto-run, YOLO or approval setting can allow the agent to run it."

/**
 * Reduce raw command text to the forms a shell would execute after quote and escape removal. A backslash is both a
 * shell escape (`aihydro-appro\ve`) and a Windows path separator (`ai_hydro\approval`), so it is deleted in one
 * variant and turned into `/` in another. Each of those is then also produced with all whitespace removed (so
 * `ai_hydro . approval` and a backslash-newline continuation collapse) and with unset-variable-style expansions
 * removed (`aihydro-${x}approve`, `aihydro-$''approve`). Non-ASCII characters are dropped.
 */
function protectedMatchVariants(raw: string): string[] {
	const base = raw
		.toLowerCase()
		.replace(/[\u2010-\u2015\u2212]/g, "-")
		.replace(/['"]/g, "")
		.replace(/[^\x20-\x7e\n]/g, "")
	const out: string[] = []
	for (const unescaped of [base.replace(/\\\n/g, "").replace(/\\/g, ""), base.replace(/\\/g, "/")]) {
		// `$` alone (what is left of `$''` and `$""`), and braced/special parameters that expand to nothing.
		const dollarOnly = unescaped.replace(/\$/g, "")
		const noParameters = unescaped.replace(/\$\{[^}]*\}|\$[@*#?!0-9]/g, "")
		for (const text of [unescaped, dollarOnly, noParameters]) {
			out.push(text.replace(/\s+/g, " "), text.replace(/\s+/g, ""))
		}
	}
	return out
}

/** Whether a shell glob (`appr*`, `app?ove`, `[a]pprove`) could expand to `target`. Unparseable globs match (fail closed). */
function globCouldMatch(glob: string, target: string): boolean {
	if (!/[?*[]/.test(glob)) {
		return false
	}
	try {
		const source = glob
			.replace(/[.+^${}()|\\]/g, "\\$&")
			.replace(/\*/g, ".*")
			.replace(/\?/g, ".")
		return new RegExp(`^${source}$`).test(target)
	} catch {
		return true
	}
}

/**
 * Glob forms of the protected names: `aihydro-appro?e`, `aihydro-appr*`, `ai_hydro/appr*`, `ai_hydro.app?oval`.
 * The program name is spelled out and only the tail is a glob, so the match is exact about what the glob can reach.
 */
function matchProtectedGlob(variant: string): string | undefined {
	for (const [prefix, target, name] of [
		[/aihydro-([a-z0-9_?*[\]-]+)/g, "approve", "aihydro-approve (glob)"],
		[/ai_hydro[./]([a-z0-9_?*[\]-]+)/g, "approval", "ai_hydro approval (glob)"],
	] as const) {
		for (const m of variant.matchAll(prefix)) {
			if (globCouldMatch(m[1], target)) {
				return name
			}
		}
	}
	return undefined
}

/**
 * The protected pattern found in `raw`, or undefined. Substring match anywhere in the raw text after stripping
 * quotes and backslashes, so path prefixes, `sh -c '...'`, `env ...`, `python -m ai_hydro.approval.cli`,
 * `;`/`&&`/`|` chains, here-docs and `$(...)` that inline the name are all caught. False positives (for
 * example `grep aihydro-approve README`) deny, which is the safe direction.
 */
export function matchProtectedCommand(raw: string): string | undefined {
	for (const variant of protectedMatchVariants(raw)) {
		for (const pattern of PROTECTED_COMMAND_SUBSTRINGS) {
			if (variant.includes(pattern)) {
				return pattern
			}
		}
		if (PROTECTED_IMPORT_PATTERN.test(variant)) {
			return "ai_hydro import approval"
		}
		const glob = matchProtectedGlob(variant)
		if (glob) {
			return glob
		}
	}
	return undefined
}

// ---------------------------------------------------------------------------------------------------------------
// 1b. Subagent launches
// ---------------------------------------------------------------------------------------------------------------

export const SUBAGENTS_DISABLED_MESSAGE =
	"Subagents are disabled. Launching an `aihydro` subagent was refused. The user can enable subagents in AI-Hydro settings; do not retry this launch until they do."

export const SUBAGENT_LAUNCH_REFUSED_MESSAGE =
	'Subagent launch refused: the model may not set YOLO, a profile environment variable or extra settings. Use exactly `aihydro "prompt"` with optional `--profile explorer|data-runner` and `--workdir <dir>`.'

const SUBAGENT_PATTERN = /^aihydro\s+(['"])(.+?)\1(\s+.*)?$/

/**
 * Whether any word of the command is the `aihydro` CLI program, after quote/escape/case/path normalisation and
 * across chains, `env`/prefix wrappers and absolute paths: `cd . && aihydro "x"`, `env aihydro "x"`,
 * `/usr/local/bin/aihydro "x"`, `AIHYDRO "x"`, `aihydro -y "x"`. Deliberately broad: a word that merely equals
 * `aihydro` (`cat aihydro`) is also treated as a launch, which only means it asks (or is refused while subagents
 * are disabled). The indirection limits in the file header apply here too.
 */
export function mentionsAihydroProgram(raw: string): boolean {
	const base = raw
		.toLowerCase()
		.replace(/['"]/g, "")
		.replace(/[^\x20-\x7e\n]/g, "")
	for (const text of [base.replace(/\\/g, ""), base.replace(/\\/g, "/")]) {
		for (const token of text.split(/[\s;&|()<>`${}=,]+/)) {
			const program = (token.split("/").pop() ?? "").replace(/\.(exe|cmd|bat|ps1|js|mjs)$/, "")
			if (program === "aihydro") {
				return true
			}
		}
	}
	return false
}

/**
 * Why a launch must be refused regardless of approval, or undefined. The model may not choose the subagent's
 * approval policy: no YOLO (`-y`, `--yolo`, `yolo_mode_toggled`), no `AIHYDRO_PROFILE=` environment prefix, and for
 * the standard form `aihydro "prompt" <flags>` only `--profile` and `--workdir` after the prompt (anything else, such
 * as a later `-s yolo_mode_toggled=true`, would override the flags the host injects).
 */
export function subagentLaunchRefusal(command: string): string | undefined {
	if (/aihydro_profile\s*=/i.test(command)) {
		return SUBAGENT_LAUNCH_REFUSED_MESSAGE
	}
	const match = command.trim().match(SUBAGENT_PATTERN)
	if (match) {
		const tokens = (match[3] ?? "").trim().split(/\s+/).filter(Boolean)
		for (let i = 0; i < tokens.length; i++) {
			const flag = tokens[i]
			const value = tokens[i + 1]
			if ((flag === "--workdir" || flag === "--profile") && value !== undefined && !value.startsWith("-")) {
				i += 1
			} else {
				return SUBAGENT_LAUNCH_REFUSED_MESSAGE
			}
		}
		return undefined
	}
	const words = command.toLowerCase().split(/[\s'"=;&|()]+/)
	if (/yolo/i.test(command) || words.includes("-y") || words.includes("--yes")) {
		return SUBAGENT_LAUNCH_REFUSED_MESSAGE
	}
	return undefined
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Read-only classifier: see readOnlyClassifier.ts (re-exported here)
// ---------------------------------------------------------------------------------------------------------------

export { type CommandClassification, classifyCommand, type ShellEnvironment } from "./readOnlyClassifier"

// ---------------------------------------------------------------------------------------------------------------
// 3. Protected paths mentioned in command text
// ---------------------------------------------------------------------------------------------------------------

const PROTECTED_PATH_PATTERNS: readonly RegExp[] = [
	/(^|[/\s=:~])\.ssh([/\s]|$)/,
	/\.aihydro\/(approvals|trust|registry)(\/|\s|$)/,
	/\$\{?aihydro_home\}?|%aihydro_home%/,
	/aihydro_mcp_settings\.json/,
	// A repository's config and hooks can make git run programs (core.pager, core.fsmonitor, hooks).
	/(^|[/\s=:])\.git\/(config|hooks)/,
]

/**
 * Whether command text mentions protected state. `protectedRoots` are absolute directories or files the host
 * resolved (extension storage, the MCP settings file, $AIHYDRO_HOME/{approvals,trust,registry}, ~/.ssh).
 * Text-based, so a relative path in an unrelated working directory is invisible to it; file TOOLS get an exact
 * resolved-path check instead (protectedPaths.ts).
 */
export function commandMentionsProtectedPath(raw: string, protectedRoots: readonly string[] = []): boolean {
	const text = raw.toLowerCase().replace(/['"]/g, "").replace(/\\/g, "/")
	if (PROTECTED_PATH_PATTERNS.some((p) => p.test(text))) {
		return true
	}
	return protectedRoots.some((root) => {
		const normalised = root.toLowerCase().replace(/\\/g, "/").replace(/\/+$/, "")
		return normalised.length > 0 && text.includes(normalised)
	})
}

// ---------------------------------------------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------------------------------------------

export interface CommandPolicyInput {
	/** The command that will run (after any workspace-hint rewriting). Classified and scanned. */
	command: string
	/** The command exactly as the model wrote it, when it differs from `command`. Scanned too. */
	rawCommand?: string
	/** The model's `requires_approval` claim. May only tighten. */
	modelRequiresApproval: boolean
	/** "Run read-only commands" (executeSafeCommands); YOLO supplies true. */
	autoApproveSafe: boolean
	/** "Execute all commands" (executeAllCommands); YOLO supplies true. */
	autoApproveAll: boolean
	/** Optional extra signal; launches are also detected from the command text itself (mentionsAihydroProgram). */
	isSubagentLaunch?: boolean
	subagentsEnabled: boolean
	/** Result of commandPolicyMentionsProtectedPath for this command. */
	touchesProtectedPath: boolean
	/** Shell used for classification; defaults to this process's platform and $SHELL. Tests inject it. */
	shellEnvironment?: ShellEnvironment
}

export type CommandPolicyResult =
	| { action: "deny"; reason: string; message: string }
	| { action: "ask"; reason: string }
	| { action: "run"; reason: string }

/**
 * The single ordered decision for a command. First match wins.
 *
 *  0a. protected command            -> deny   (YOLO and allow settings cannot change this)
 *  0b. subagent launch, disabled    -> deny
 *  0c. subagent launch with model-set YOLO/profile/extra flags -> deny
 *  0d. subagent launch              -> ask    (always; never auto-runs, whatever the model or settings say)
 *  0e. touches a protected path     -> ask    (YOLO and "Execute all commands" included)
 *  1.  "Run read-only commands" off -> ask
 *  2.  "Execute all commands" on    -> run    (the user's explicit choice; YOLO lands here)
 *  3.  host says read-only and the model did not ask for approval -> run
 *  4.  everything else              -> ask
 */
export function decideCommand(input: CommandPolicyInput): CommandPolicyResult {
	const texts = [input.command, input.rawCommand ?? ""]
	const protectedMatch = texts.map(matchProtectedCommand).find((m) => m !== undefined)
	if (protectedMatch) {
		return { action: "deny", reason: `protected command (${protectedMatch})`, message: PROTECTED_COMMAND_DENY_MESSAGE }
	}
	if (input.isSubagentLaunch || texts.some(mentionsAihydroProgram)) {
		if (!input.subagentsEnabled) {
			return { action: "deny", reason: "subagents disabled", message: SUBAGENTS_DISABLED_MESSAGE }
		}
		const refusal = texts.map((t) => (t ? subagentLaunchRefusal(t) : undefined)).find((r) => r !== undefined)
		if (refusal) {
			return { action: "deny", reason: "subagent launch sets its own policy", message: refusal }
		}
		return { action: "ask", reason: "subagent launch always asks" }
	}
	if (input.touchesProtectedPath) {
		return { action: "ask", reason: "touches a protected path" }
	}
	if (!input.autoApproveSafe) {
		return { action: "ask", reason: "command auto-run is off" }
	}
	if (input.autoApproveAll) {
		return { action: "run", reason: "execute-all-commands is on" }
	}
	if (input.modelRequiresApproval) {
		return { action: "ask", reason: "the model asked for approval" }
	}
	const verdict = classifyCommand(input.command, input.shellEnvironment)
	return verdict.readOnly ? { action: "run", reason: "host classified read-only" } : { action: "ask", reason: verdict.reason }
}
