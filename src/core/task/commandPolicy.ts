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
 * Reduce raw command text to the forms a shell would execute after quote and escape removal. Returned as two
 * variants because a backslash is both a shell escape (`aihydro-appro\ve`) and a Windows path separator
 * (`ai_hydro\approval`): deleting it handles the first, turning it into `/` handles the second.
 */
function protectedMatchVariants(raw: string): string[] {
	const base = raw.toLowerCase().replace(/['"]/g, "")
	return [base.replace(/\\/g, ""), base.replace(/\\/g, "/")].map((s) => s.replace(/\s+/g, " "))
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
	}
	return undefined
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Read-only classifier
// ---------------------------------------------------------------------------------------------------------------

export interface CommandClassification {
	readOnly: boolean
	/** Why the command is not read-only (or "read-only"). For logs and tests; not shown as a safety claim. */
	reason: string
}

/**
 * Programs with no way to write, execute or reach the network through their normal flags. A program appears
 * here only after its flags were checked; the ones with a write/exec flag carry a banned-flag rule below.
 */
const READ_ONLY_PROGRAMS: ReadonlySet<string> = new Set([
	"ls",
	"cat",
	"head",
	"tail",
	"wc",
	"pwd",
	"echo",
	"which",
	"whoami",
	"stat",
	"file",
	"diff",
	"cmp",
	"du",
	"df",
	"basename",
	"dirname",
	"realpath",
	"readlink",
	"sort",
	"cut",
	"tr",
	"nl",
	"tac",
	"rev",
	"md5sum",
	"sha1sum",
	"sha256sum",
	"shasum",
	"uname",
	"id",
	"tree",
	"grep",
	"egrep",
	"fgrep",
	"rg",
	"jq",
	"true",
	"find",
	"git",
	// Windows cmd built-ins and tools.
	"dir",
	"type",
	"where",
	"findstr",
])

/** Flags that turn an otherwise read-only program into a writer or executor. */
const BANNED_FLAGS: Record<string, (flag: string) => boolean> = {
	// sort -o FILE / --output=FILE writes; -o may sit in a cluster (-uo).
	sort: (f) => /^-[A-Za-z]*o/.test(f) || f.startsWith("--output"),
	// tree -o FILE writes.
	tree: (f) => /^-[A-Za-z]*o/.test(f) || f.startsWith("--output"),
	// ripgrep --pre CMD executes CMD per file.
	rg: (f) => f.startsWith("--pre") || f.startsWith("--hostname-bin"),
	// file -C writes a compiled magic file.
	file: (f) => f === "-C" || f === "--compile",
	// Following never exits, so it would hang rather than finish.
	tail: (f) => /^-[A-Za-z]*[fF]/.test(f) || f.startsWith("--follow"),
	find: (f) => ["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls"].includes(f),
}

const GIT_SIMPLE_READ_SUBCOMMANDS: ReadonlySet<string> = new Set([
	"status",
	"log",
	"diff",
	"show",
	"blame",
	"rev-parse",
	"ls-files",
	"ls-tree",
	"cat-file",
	"describe",
	"shortlog",
	"rev-list",
	"show-ref",
	"name-rev",
	"count-objects",
	"grep",
	"whatchanged",
	"diff-tree",
	"diff-files",
	"diff-index",
	"merge-base",
	"for-each-ref",
	"check-ignore",
])

/** Git flags that write a file, run an external program, or open a pager command. */
function isBannedGitFlag(word: string): boolean {
	return (
		word.startsWith("--output") ||
		word === "--ext-diff" ||
		word === "--textconv" ||
		word.startsWith("--open-files-in-pager") ||
		word.startsWith("-O") ||
		word.startsWith("--exec")
	)
}

const GIT_LIST_ONLY_FLAGS: ReadonlySet<string> = new Set([
	"-a",
	"-r",
	"-v",
	"-vv",
	"-l",
	"-n",
	"--all",
	"--remotes",
	"--verbose",
	"--list",
	"--show-current",
	"--merged",
	"--no-merged",
])

function isReadOnlyGit(words: string[]): boolean {
	let i = 1
	// Global options. `-c key=value` (and --exec-path/--config-env) can make git run arbitrary programs, so only
	// a few inert ones are accepted.
	while (i < words.length && words[i].startsWith("-")) {
		const word = words[i]
		if (["--no-pager", "--no-optional-locks", "--no-replace-objects", "--literal-pathspecs", "-P"].includes(word)) {
			i += 1
		} else if (word === "-C" && i + 1 < words.length) {
			i += 2
		} else {
			return false
		}
	}
	const sub = words[i]
	if (!sub) {
		return false
	}
	const rest = words.slice(i + 1)
	if (rest.some(isBannedGitFlag)) {
		return false
	}
	if (GIT_SIMPLE_READ_SUBCOMMANDS.has(sub)) {
		return true
	}
	switch (sub) {
		case "branch":
		case "tag": {
			const dashed = rest.filter((w) => w.startsWith("-"))
			const bare = rest.filter((w) => !w.startsWith("-"))
			const dashedOk = dashed.every(
				(w) =>
					GIT_LIST_ONLY_FLAGS.has(w) ||
					w.startsWith("--sort=") ||
					w.startsWith("--format=") ||
					w.startsWith("--contains="),
			)
			// A bare argument is a name to create unless a list flag turns it into a pattern.
			const listing = rest.includes("--list") || rest.includes("-l")
			return dashedOk && (bare.length === 0 || listing)
		}
		case "remote":
			return rest.length === 0 || (rest.length === 1 && (rest[0] === "-v" || rest[0] === "--verbose"))
		case "config":
			return ["--get", "--get-all", "--get-regexp", "--list", "-l"].includes(rest[0] ?? "")
		case "stash":
			return rest[0] === "list" || rest[0] === "show"
		case "reflog":
			return rest.length === 0 || rest[0] === "show"
		default:
			return false
	}
}

/**
 * Split into pipeline segments of words, quote- and escape-aware. Returns undefined when the text contains
 * anything a conservative classifier must not interpret: command separators, background, redirection,
 * substitution, variable expansion, here-docs, newlines, or an unterminated quote.
 *
 * These characters are rejected even inside quotes (`grep "a>b" f` asks). That costs a prompt now and then and
 * removes every quoting edge case.
 */
function splitPipeline(command: string): string[][] | undefined {
	const segments: string[][] = []
	let words: string[] = []
	let word = ""
	let inWord = false
	let quote: "'" | '"' | undefined

	const endWord = () => {
		if (inWord) {
			words.push(word)
		}
		word = ""
		inWord = false
	}

	for (let i = 0; i < command.length; i++) {
		const ch = command[i]
		if (/[\n\r\0;&<>`]/.test(ch)) {
			return undefined
		}
		if (quote === "'") {
			if (ch === "'") {
				quote = undefined
			} else {
				word += ch
			}
			continue
		}
		if (ch === "$") {
			return undefined
		}
		if (quote === '"') {
			if (ch === '"') {
				quote = undefined
			} else if (ch === "\\") {
				i += 1
				if (i >= command.length) {
					return undefined
				}
				word += command[i]
			} else {
				word += ch
			}
			continue
		}
		if (ch === "'" || ch === '"') {
			quote = ch
			inWord = true
		} else if (ch === "\\") {
			i += 1
			if (i >= command.length) {
				return undefined
			}
			word += command[i]
			inWord = true
		} else if (ch === "|") {
			endWord()
			if (words.length === 0) {
				return undefined // `||` or a leading pipe
			}
			segments.push(words)
			words = []
		} else if (/\s/.test(ch)) {
			endWord()
		} else {
			word += ch
			inWord = true
		}
	}
	if (quote) {
		return undefined
	}
	endWord()
	if (words.length === 0) {
		return undefined
	}
	segments.push(words)
	return segments
}

function classifySegment(words: string[]): CommandClassification {
	const program = words[0]
	if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(program)) {
		return { readOnly: false, reason: "leading variable assignment" }
	}
	if (program.includes("/") || program.includes("\\")) {
		return { readOnly: false, reason: `program given as a path: ${program}` }
	}
	if (!READ_ONLY_PROGRAMS.has(program)) {
		return { readOnly: false, reason: `'${program}' is not on the read-only allowlist` }
	}
	if (program === "git") {
		return isReadOnlyGit(words)
			? { readOnly: true, reason: "read-only" }
			: { readOnly: false, reason: "git subcommand or flag is not read-only" }
	}
	const banned = BANNED_FLAGS[program]
	if (banned) {
		const hit = words.slice(1).find((w) => w.startsWith("-") && banned(w))
		if (hit) {
			return { readOnly: false, reason: `${program} ${hit} can write or execute` }
		}
	}
	return { readOnly: true, reason: "read-only" }
}

/**
 * Host-side verdict: is this command read-only? Conservative: when in doubt, it is not. A pipeline qualifies only
 * if every segment does. Anything with `;`, `&&`, `||`, `&`, redirection, `$(...)`, backticks, `$VAR`, here-docs
 * or an unknown program is not read-only.
 */
export function classifyCommand(command: string): CommandClassification {
	const trimmed = command.trim()
	if (!trimmed) {
		return { readOnly: false, reason: "empty command" }
	}
	const segments = splitPipeline(trimmed)
	if (!segments) {
		return { readOnly: false, reason: "contains a separator, redirection, substitution, expansion or unterminated quote" }
	}
	for (const words of segments) {
		const verdict = classifySegment(words)
		if (!verdict.readOnly) {
			return verdict
		}
	}
	return { readOnly: true, reason: "read-only" }
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Protected paths mentioned in command text
// ---------------------------------------------------------------------------------------------------------------

const PROTECTED_PATH_PATTERNS: readonly RegExp[] = [
	/(^|[/\s=:~])\.ssh([/\s]|$)/,
	/\.aihydro\/(approvals|trust|registry)(\/|\s|$)/,
	/\$\{?aihydro_home\}?|%aihydro_home%/,
	/aihydro_mcp_settings\.json/,
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
	/** The command exactly as the model wrote it, when it differs from `command`. Scanned for protected commands too. */
	rawCommand?: string
	/** The model's `requires_approval` claim. May only tighten. */
	modelRequiresApproval: boolean
	/** "Run read-only commands" (executeSafeCommands); YOLO supplies true. */
	autoApproveSafe: boolean
	/** "Execute all commands" (executeAllCommands); YOLO supplies true. */
	autoApproveAll: boolean
	isSubagentLaunch: boolean
	subagentsEnabled: boolean
	/** Result of commandMentionsProtectedPath for this command. */
	touchesProtectedPath: boolean
}

export type CommandPolicyResult =
	| { action: "deny"; reason: string; message: string }
	| { action: "ask"; reason: string }
	| { action: "run"; reason: string }

export const SUBAGENTS_DISABLED_MESSAGE =
	"Subagents are disabled. Launching an `aihydro` subagent was refused. The user can enable subagents in AI-Hydro settings; do not retry this launch until they do."

/**
 * The single ordered decision for a command. First match wins.
 *
 *  0a. protected command            -> deny   (YOLO and allow settings cannot change this)
 *  0b. subagent launch, disabled    -> deny
 *  0c. subagent launch              -> ask    (always; never auto-runs, whatever the model or settings say)
 *  0d. touches a protected path     -> ask    (YOLO and "Execute all commands" included)
 *  1.  "Run read-only commands" off -> ask
 *  2.  "Execute all commands" on    -> run    (the user's explicit choice; YOLO lands here)
 *  3.  host says read-only and the model did not ask for approval -> run
 *  4.  everything else              -> ask
 */
export function decideCommand(input: CommandPolicyInput): CommandPolicyResult {
	const protectedMatch = matchProtectedCommand(input.command) ?? matchProtectedCommand(input.rawCommand ?? "")
	if (protectedMatch) {
		return { action: "deny", reason: `protected command (${protectedMatch})`, message: PROTECTED_COMMAND_DENY_MESSAGE }
	}
	if (input.isSubagentLaunch && !input.subagentsEnabled) {
		return { action: "deny", reason: "subagents disabled", message: SUBAGENTS_DISABLED_MESSAGE }
	}
	if (input.isSubagentLaunch) {
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
	const verdict = classifyCommand(input.command)
	return verdict.readOnly ? { action: "run", reason: "host classified read-only" } : { action: "ask", reason: verdict.reason }
}
