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

import type { CommandPolicyClass } from "@shared/aihydro/commandEvidence"
import { hardenGitEnvironment } from "./gitHardening"
import { classifyCommand, commandRunsGit, type ShellEnvironment } from "./readOnlyClassifier"

// ---------------------------------------------------------------------------------------------------------------
// 1. Protected commands (hard deny)
// ---------------------------------------------------------------------------------------------------------------

const PROTECTED_COMMAND_SUBSTRINGS = [
	"aihydro-approve",
	"ai_hydro.approval",
	"ai_hydro/approval",
	// Learning Pack signing (docs/learning-pack-authoring.md): creating or using the publisher key is an owner action.
	// `verify`, `inspect`, `build` and `fingerprint` of a public key or pack are not protected.
	"aihydro-pack sign",
	"aihydro-pack init-key",
	"aihydro-packsign",
	"aihydro-packinit-key",
	"authoring/sign",
	"authoring/keys",
	"authoring/cli",
	// The default key directory and key file names: any command that names them (cat, cp, tar, ...) is denied.
	// Agent FILE tools are already blocked from ~/.ssh by protectedPaths.ts; this is the command-level counterpart.
	"aihydro-learning-pack",
	"ed25519.key.pem",
] as const
/**
 * `aihydro-pack.cjs sign`, `aihydro-pack.ts init-key`, `npm run aihydro-pack -- sign`: the program name, an optional
 * extension, optional npm-style flags, an optional `--` separator, then the protected subcommand (whitespace already normalised or removed).
 */
const PROTECTED_PACK_PATTERN = /aihydro-pack(?:\.[a-z]{2,4})?(?:\s*--?[a-z][a-z-]*)*\s*(?:--\s*)?(?:sign|init-key)/
/** Substrings that belong to the Learning Pack signer rather than claim approval (they get their own message). */
const PACK_SIGNING_MARKERS = ["aihydro-pack", "authoring/", "aihydro-learning-pack", "ed25519.key"] as const
/** `from ai_hydro import approval` style imports: the dotted name never appears, so match the shape. */
const PROTECTED_IMPORT_PATTERN = /ai_hydro\s+import\s[^\n;|&]*\bapproval\b/

export const PROTECTED_PACK_SIGNING_DENY_MESSAGE =
	"Blocked by AI-Hydro: this command creates or uses the Learning Pack signing key. Key creation and signing must " +
	"be done by you, in your own terminal (outside the agent): run `aihydro-pack init-key` or `aihydro-pack sign` " +
	"yourself. The signing key directory is off limits to agent commands. `aihydro-pack build`, `verify` and `inspect` " +
	"are fine for the agent to run."

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

/** The refusal text for a `matchProtectedCommand` result: the signer gets its own wording, approval keeps its text. */
export function protectedCommandDenyMessage(match: string): string {
	return PACK_SIGNING_MARKERS.some((marker) => match.startsWith(marker))
		? PROTECTED_PACK_SIGNING_DENY_MESSAGE
		: PROTECTED_COMMAND_DENY_MESSAGE
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
		if (PROTECTED_PACK_PATTERN.test(variant)) {
			return "aihydro-pack sign/init-key"
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
// 1b. The retired `aihydro` CLI subagent: every launch is denied
// ---------------------------------------------------------------------------------------------------------------

export const AIHYDRO_CLI_RETIRED_MESSAGE =
	"The `aihydro` command-line subagent was retired and cannot be launched from a terminal command. Do not retry it; do the work in this chat with the available tools."

/** Words that run the next word as a command: skipped, with their own flags, to find the command position. */
const COMMAND_WRAPPERS = new Set([
	"env",
	"sudo",
	"doas",
	"command",
	"exec",
	"nohup",
	"xargs",
	"time",
	"nice",
	"builtin",
	"sh",
	"bash",
	"zsh",
	"dash",
])
/** Wrapper flags that take a separate value, which must not be mistaken for the command. */
const WRAPPER_FLAGS_WITH_VALUE: Record<string, readonly string[]> = {
	env: ["-u", "-c", "-s", "-p"],
	sudo: ["-u", "-g", "-h", "-p", "-c", "-r", "-t"],
	doas: ["-u"],
	xargs: ["-i", "-l", "-n", "-p", "-s", "-d"],
	nice: ["-n"],
}

/**
 * Whether the `aihydro` CLI program is run by this command: the word in COMMAND POSITION of any segment (after
 * `; && || | & ( ) { }`, a newline, a backtick or `$(`), after `NAME=value` prefixes and wrappers such as `env`,
 * `sudo`, `command`, `exec`, `nohup`, `xargs` or `sh -c`. The word must have the exact basename `aihydro` or
 * `aihydro.exe` after quote, escape, case and path normalisation (`/usr/local/bin/aihydro`, `"AIHYDRO"`,
 * `C:\\tools\\aihydro.exe`). No glob is expanded, and a path argument or variable that merely contains the word
 * (`ls ~/code/aihydro`, `pytest tests/aihydro`, `export PROJ=aihydro`, `echo > aihydro.js`) is not a launch.
 * The indirection limits in the file header apply here too.
 */
export function mentionsAihydroProgram(raw: string): boolean {
	const base = raw
		.toLowerCase()
		.replace(/['"]/g, "")
		.replace(/[^\x20-\x7e\n]/g, "")
	for (const text of [base.replace(/\\/g, ""), base.replace(/\\/g, "/")]) {
		for (const segment of text.split(/[;&|(){}`\n]|\$\(/)) {
			if (segmentRunsAihydro(segment.trim().split(/\s+/).filter(Boolean))) {
				return true
			}
		}
	}
	return false
}

function segmentRunsAihydro(tokens: string[]): boolean {
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]
		if (/^[a-z_][a-z0-9_]*=/.test(token)) {
			continue // NAME=value prefix
		}
		const program = (token.split("/").pop() ?? "").replace(/\.exe$/, "")
		if (program === "aihydro") {
			return true
		}
		if (!COMMAND_WRAPPERS.has(program)) {
			return false // some other command: its arguments are not a launch
		}
		// Skip the wrapper's own flags (and the value of those that take one).
		while (i + 1 < tokens.length && tokens[i + 1].startsWith("-")) {
			i += 1
			if (WRAPPER_FLAGS_WITH_VALUE[program]?.includes(tokens[i]) && i + 1 < tokens.length) {
				i += 1
			}
		}
	}
	return false
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Read-only classifier: see readOnlyClassifier.ts (re-exported here)
// ---------------------------------------------------------------------------------------------------------------

export { type CommandClassification, classifyCommand, commandRunsGit, type ShellEnvironment } from "./readOnlyClassifier"

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
	/** Result of commandPolicyMentionsProtectedPath for this command. */
	touchesProtectedPath: boolean
	/** Shell used for classification; defaults to this process's platform and $SHELL. Tests inject it. */
	shellEnvironment?: ShellEnvironment
}

export type CommandPolicyResult =
	| { action: "deny"; reason: string; message: string }
	| { action: "ask"; reason: string; policyClass?: CommandPolicyClass }
	| { action: "run"; reason: string; policyClass?: CommandPolicyClass }

/**
 * The single ordered decision for a command. First match wins.
 *
 *  0a. protected command            -> deny   (YOLO and allow settings cannot change this)
 *  0b. `aihydro` CLI launch          -> deny   (the CLI subagent is retired; no setting re-enables it)
 *  0e. touches a protected path     -> ask    (YOLO and "Execute all commands" included)
 *  1.  "Run read-only commands" off -> ask
 *  2.  "Execute all commands" on    -> run    (the user's explicit choice; YOLO lands here)
 *  3.  host says read-only and the model did not ask for approval -> run
 *  4.  everything else              -> ask
 */
/** The `reason` of a run that the host classified read-only. */
export const HOST_READ_ONLY_REASON = "host classified read-only"

/**
 * The text to execute for an approved command. A host-classified read-only command that runs git is wrapped so git
 * sees a hardened environment (see gitHardening.ts); everything else runs unchanged.
 */
export function commandToExecute(command: string, decision: CommandPolicyResult): string {
	return decision.action === "run" && decision.reason === HOST_READ_ONLY_REASON && commandRunsGit(command)
		? hardenGitEnvironment(command)
		: command
}

export function decideCommand(input: CommandPolicyInput): CommandPolicyResult {
	const texts = [input.command, input.rawCommand ?? ""]
	const protectedMatch = texts.map(matchProtectedCommand).find((m) => m !== undefined)
	if (protectedMatch) {
		return {
			action: "deny",
			reason: `protected command (${protectedMatch})`,
			message: protectedCommandDenyMessage(protectedMatch),
		}
	}
	if (texts.some(mentionsAihydroProgram)) {
		return { action: "deny", reason: "aihydro CLI subagent retired", message: AIHYDRO_CLI_RETIRED_MESSAGE }
	}
	if (input.touchesProtectedPath) {
		return { action: "ask", reason: "touches a protected path", policyClass: "protected_path" }
	}
	if (!input.autoApproveSafe) {
		return { action: "ask", reason: "command auto-run is off" }
	}
	if (input.autoApproveAll) {
		return { action: "run", reason: "execute-all-commands is on", policyClass: "auto_run_all" }
	}
	if (input.modelRequiresApproval) {
		return { action: "ask", reason: "the model asked for approval", policyClass: "model_requested_approval" }
	}
	const verdict = classifyCommand(input.command, input.shellEnvironment)
	return verdict.readOnly
		? { action: "run", reason: HOST_READ_ONLY_REASON }
		: { action: "ask", reason: verdict.reason, policyClass: "not_read_only" }
}
