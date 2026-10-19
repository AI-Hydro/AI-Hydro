/**
 * Host-side read-only command classifier (approval redesign AP1, finding B1). Pure and dependency-free.
 *
 * Design rule: FAIL CLOSED. A command is read-only only if every part of it is understood. Anything the parser
 * does not model is "not read-only", which means it asks.
 *
 *  - Shell syntax is not modelled, it is rejected. Outside quotes these characters reject the command:
 *      ; & | (only `|` between plain commands is accepted) < > ` $ ( ) { } * ? [ ] ! # and a word starting with `=`,
 *      `~` or `^` (a mid-word `~`/`^`, as in `HEAD~1`, is literal).
 *    That removes command and process substitution, zsh glob qualifiers `*(e:...:)`, zsh `=(...)`, brace expansion
 *    (which can hide a banned flag: `sort {-o,out}`), history expansion, comments and globbing. Inside quotes the
 *    characters that stay live there (; & < > ` $ ! and control characters) still reject. Non-ASCII and control
 *    characters reject everywhere.
 *  - Flags are checked against a per-program ALLOW-list, never a deny-list. A flag that is not listed (including an
 *    abbreviation such as `--ou` or `--fo`, which getopt accepts for unique prefixes) rejects the command. Programs
 *    whose flag surface could not be allow-listed (sort, file, tree, rg, jq, awk, sed, xargs, env, ...) are not on
 *    the allowlist at all.
 *  - Only POSIX shells are modelled. On Windows, or when the user's shell is not bash/zsh/sh/dash (PowerShell, cmd,
 *    fish, csh), nothing is classified read-only: PowerShell aliases (`ls`, `sort`) accept script blocks and
 *    `(cmd)` subexpressions that this parser does not understand.
 *
 * It is a filter, not a sandbox. It knows nothing about hostile files, aliases, PATH entries, or repository
 * configuration that git (or any program) reads: a repository `core.pager` or `core.fsmonitor` set by an earlier
 * write can still make an allowed `git` subcommand run a program. Writes into `.git/` are therefore protected paths
 * (protectedPaths.ts), but a pre-existing hostile repository config is out of scope.
 */

export interface CommandClassification {
	readOnly: boolean
	/** Why the command is not read-only (or "read-only"). For logs and tests; never shown as a safety claim. */
	reason: string
}

export interface ShellEnvironment {
	platform: string
	/** $SHELL of the host process; the terminal's shell is assumed to match it. */
	shell?: string
}

const POSIX_SHELLS = new Set(["bash", "zsh", "sh", "dash"])

function defaultEnvironment(): ShellEnvironment {
	return { platform: process.platform, shell: process.env.SHELL }
}

/** Per-program flag allow-list. `short` are letters that may appear in a cluster (`-la`); `exact` are whole words. */
interface FlagSpec {
	short?: string
	exact?: readonly string[]
	patterns?: readonly RegExp[]
}

const NO_FLAGS: FlagSpec = {}

const GREP_SPEC: FlagSpec = {
	short: "inrRlLcvwxqsHhEFGoaI",
	exact: [
		"-e",
		"-f",
		"-m",
		"-A",
		"-B",
		"-C",
		"--recursive",
		"--ignore-case",
		"--line-number",
		"--count",
		"--files-with-matches",
		"--files-without-match",
		"--invert-match",
		"--word-regexp",
		"--fixed-strings",
		"--extended-regexp",
		"--no-messages",
		"--color",
	],
	patterns: [/^-[ABCm]\d+$/, /^--(include|exclude|exclude-dir)=[^\s]+$/, /^--color=\w+$/],
}

const PROGRAMS: Record<string, FlagSpec | "any"> = {
	ls: {
		short: "alhRrtSd1FiLpGsAcuxXnoUCqQbBfgkvwHTZ",
		exact: [
			"--all",
			"--almost-all",
			"--human-readable",
			"--recursive",
			"--reverse",
			"--size",
			"--classify",
			"--directory",
			"--group-directories-first",
			"--color",
		],
		patterns: [/^--color=\w+$/],
	},
	cat: { short: "nbsETAvu" },
	head: { short: "qv", exact: ["-n", "-c"], patterns: [/^-[nc]?\d+$/] },
	tail: { short: "qv", exact: ["-n", "-c"], patterns: [/^-[nc]?\d+$/] }, // no -f/-F: following never exits
	wc: { short: "lwcmL" },
	pwd: { short: "LP" },
	whoami: NO_FLAGS,
	id: { short: "ugGnr" },
	uname: { short: "asnrvmopi" },
	echo: "any",
	true: "any",
	which: { short: "a" },
	grep: GREP_SPEC,
	egrep: GREP_SPEC,
	fgrep: GREP_SPEC,
	diff: {
		short: "uqrNwbBiEZyc",
		exact: ["--brief", "--unified", "--recursive", "--ignore-all-space", "--ignore-space-change"],
		patterns: [/^-U\d+$/, /^--unified=\d+$/],
	},
	cmp: { short: "sl" },
	du: {
		short: "shackmx",
		exact: ["-d", "--summarize", "--human-readable", "--max-depth"],
		patterns: [/^--max-depth=\d+$/, /^-d\d+$/],
	},
	df: { short: "hkTiHP" },
	basename: { short: "as" },
	dirname: NO_FLAGS,
	realpath: { short: "ems" },
	readlink: { short: "femn" },
	md5sum: { short: "bct" },
	sha1sum: { short: "bct" },
	sha256sum: { short: "bct" },
	shasum: { short: "bct", exact: ["-a"] },
	tr: { short: "dsc" },
	cut: { exact: ["-s", "--complement"], patterns: [/^-[dfcb][^\s]*$/] },
	nl: { patterns: [/^-[bhfnwsvi][^\s]*$/] },
	tac: NO_FLAGS,
	rev: NO_FLAGS,
}

/** Whether every dash-word in `args` is allowed by `spec`. Words after a bare `--` are operands. */
function flagsAllowed(args: string[], spec: FlagSpec): string | undefined {
	for (const word of args) {
		if (word === "--") {
			return undefined
		}
		if (word.length < 2 || word[0] !== "-") {
			continue // operand (or a lone "-" meaning stdin)
		}
		if (spec.exact?.includes(word) || spec.patterns?.some((p) => p.test(word))) {
			continue
		}
		if (word[1] !== "-" && spec.short && [...word.slice(1)].every((c) => spec.short!.includes(c))) {
			continue
		}
		return word
	}
	return undefined
}

/** find: start points and an allow-list of read-only primaries. Numeric tests (`-5`, `+7`) are values. */
const FIND_PRIMARIES = new Set([
	"-name",
	"-iname",
	"-type",
	"-maxdepth",
	"-mindepth",
	"-path",
	"-ipath",
	"-size",
	"-mtime",
	"-atime",
	"-ctime",
	"-mmin",
	"-newer",
	"-empty",
	"-print",
	"-print0",
	"-not",
	"-and",
	"-or",
	"-o",
	"-a",
	"-user",
	"-group",
	"-perm",
	"-regex",
	"-L",
	"-H",
	"-P",
])

function findAllowed(args: string[]): string | undefined {
	for (const word of args) {
		if (word.length > 1 && word[0] === "-" && !FIND_PRIMARIES.has(word) && !/^[-+]?\d+[a-zA-Z]?$/.test(word)) {
			return word
		}
	}
	return undefined
}

// ---- git ------------------------------------------------------------------------------------------------------

const GIT_REV_FLAGS: FlagSpec = {
	exact: [
		"--oneline",
		"--graph",
		"--decorate",
		"--stat",
		"--shortstat",
		"--numstat",
		"--name-only",
		"--name-status",
		"--abbrev-commit",
		"--no-merges",
		"--merges",
		"--all",
		"--follow",
		"--first-parent",
		"--reverse",
		"--cached",
		"--staged",
		"--no-color",
		"--color",
		"--minimal",
		"--patch",
		"--no-ext-diff",
		"--no-textconv",
		"-p",
		"-n",
		"-w",
		"--ignore-all-space",
		"--summary",
		"--",
	],
	patterns: [
		/^-\d+$/,
		/^-U\d+$/,
		/^--unified=\d+$/,
		/^--(pretty|format|since|until|author|grep|date|max-count|abbrev)=[^\s]*$/,
		/^--color=\w+$/,
	],
}

const GIT_SUBCOMMANDS: Record<string, FlagSpec> = {
	status: { exact: ["-s", "-b", "-sb", "--short", "--branch", "--porcelain", "--long", "--ignored"] },
	log: GIT_REV_FLAGS,
	diff: GIT_REV_FLAGS,
	show: GIT_REV_FLAGS,
	blame: { exact: ["-w", "-e", "-l", "-s", "-L", "--porcelain", "--line-porcelain"], patterns: [/^-L[^\s]+$/] },
	"rev-parse": {
		exact: [
			"--abbrev-ref",
			"--short",
			"--show-toplevel",
			"--git-dir",
			"--is-inside-work-tree",
			"--verify",
			"--symbolic-full-name",
			"--show-prefix",
			"--show-cdup",
		],
	},
	"ls-files": {
		exact: ["-s", "--stage", "-m", "-o", "-d", "-c", "--others", "--modified", "--deleted", "--cached", "--exclude-standard"],
	},
	"ls-tree": { exact: ["-r", "-t", "-l", "--name-only", "--long"] },
	"cat-file": { exact: ["-p", "-t", "-s", "-e"] },
	describe: { exact: ["--tags", "--always", "--long", "--all", "--dirty"], patterns: [/^--abbrev=\d+$/] },
	shortlog: { exact: ["-s", "-n", "-e", "--summary", "--numbered"] },
	"rev-list": { exact: ["--count", "--all", "--oneline", "--no-merges", "--reverse", "--"], patterns: [/^--max-count=\d+$/] },
	"show-ref": { exact: ["--heads", "--tags", "--head", "-d", "--hash"] },
	"name-rev": { exact: ["--name-only", "--tags"] },
	"count-objects": { exact: ["-v", "-H"] },
	grep: { exact: ["-n", "-i", "-w", "-l", "-c", "-E", "-F", "-e", "-I", "--line-number", "--ignore-case", "--"] },
	"merge-base": { exact: ["--is-ancestor", "--fork-point", "-a"] },
	"check-ignore": { exact: ["-v", "-n"] },
}

const GIT_BRANCH_LIST_FLAGS = [
	"-a",
	"-r",
	"-v",
	"-vv",
	"-l",
	"--list",
	"--show-current",
	"--merged",
	"--no-merged",
	"--all",
	"--remotes",
	"--verbose",
	"--contains",
	"--no-contains",
]

function isReadOnlyGit(words: string[]): string | undefined {
	// Only a bare `--no-pager` is accepted before the subcommand. `-c`, `-C`, `--git-dir`, `--exec-path` and
	// `--config-env` can run programs or move to another repository.
	let i = 1
	while (words[i] === "--no-pager") {
		i += 1
	}
	const sub = words[i]
	if (!sub) {
		return "git without a subcommand"
	}
	const rest = words.slice(i + 1)
	const spec = GIT_SUBCOMMANDS[sub]
	if (spec) {
		const bad = flagsAllowed(rest, spec)
		return bad ? `git ${sub} flag ${bad} is not on the allow-list` : undefined
	}
	switch (sub) {
		case "branch":
		case "tag": {
			const flags = rest.filter((w) => w.startsWith("-"))
			const operands = rest.filter((w) => !w.startsWith("-"))
			const allowed = sub === "branch" ? GIT_BRANCH_LIST_FLAGS : ["-l", "--list", "-n"]
			if (!flags.every((f) => allowed.includes(f))) {
				return `git ${sub} flag is not a list-only flag`
			}
			// An operand is a name to create unless a list flag turns it into a pattern (or --contains takes a revision).
			const listing = flags.some(
				(f) =>
					f === "-l" ||
					f === "--list" ||
					f === "--contains" ||
					f === "--no-contains" ||
					f === "--merged" ||
					f === "--no-merged",
			)
			return operands.length === 0 || listing ? undefined : `git ${sub} with a name would create it`
		}
		case "remote":
			return rest.length === 0 || (rest.length === 1 && (rest[0] === "-v" || rest[0] === "--verbose"))
				? undefined
				: "git remote with arguments"
		case "config":
			return ["--get", "--get-all", "--get-regexp", "--list", "-l"].includes(rest[0] ?? "") &&
				rest.slice(1).every((w) => !w.startsWith("-"))
				? undefined
				: "git config is only read-only with a single --get/--list flag"
		case "stash":
			return (rest[0] === "list" || rest[0] === "show") &&
				flagsAllowed(rest.slice(1), { exact: ["--stat", "-p", "--name-only"] }) === undefined
				? undefined
				: "git stash is only read-only as list/show"
		case "reflog":
			return rest.length === 0 ||
				(rest[0] === "show" && flagsAllowed(rest.slice(1), { patterns: [/^-\d+$/], exact: ["-n"] }) === undefined)
				? undefined
				: "git reflog is only read-only as show"
		default:
			return `git ${sub} is not on the read-only allowlist`
	}
}

// ---- tokenizer ------------------------------------------------------------------------------------------------

/** Characters that reject the command when they appear unquoted. */
const UNQUOTED_REJECT = /[;&<>`$(){}*?[\]!#]/
/** Characters that stay live inside double quotes (and, for control characters, everywhere). */
const QUOTED_REJECT = /[;&<>`!]/
const CONTROL_OR_NON_ASCII = /[^\x20-\x7e\t]/

/**
 * Split into pipeline segments of words, or undefined if the text uses anything this classifier must not
 * interpret. See the file header for the rejected set.
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
		if (CONTROL_OR_NON_ASCII.test(ch)) {
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
		if (quote === '"') {
			if (QUOTED_REJECT.test(ch) || ch === "$") {
				return undefined
			}
			if (ch === '"') {
				quote = undefined
			} else if (ch === "\\") {
				i += 1
				if (i >= command.length || CONTROL_OR_NON_ASCII.test(command[i])) {
					return undefined
				}
				word += command[i]
			} else {
				word += ch
			}
			continue
		}
		if (ch === "|") {
			endWord()
			if (words.length === 0) {
				return undefined // `||` or a leading pipe
			}
			segments.push(words)
			words = []
		} else if (UNQUOTED_REJECT.test(ch)) {
			return undefined
		} else if (ch === "=" && !inWord) {
			return undefined // zsh `=cmd` / `=(...)` expansion at the start of a word
		} else if ((ch === "~" || ch === "^") && (!inWord || command[i - 1] === "=" || command[i - 1] === ":")) {
			return undefined // tilde expansion (also after = and :) and zsh extended-glob negation start a word
		} else if (ch === "'" || ch === '"') {
			quote = ch
			inWord = true
		} else if (ch === "\\") {
			i += 1
			if (i >= command.length || CONTROL_OR_NON_ASCII.test(command[i])) {
				return undefined
			}
			word += command[i]
			inWord = true
		} else if (ch === " " || ch === "\t") {
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
	if (program === "git") {
		const problem = isReadOnlyGit(words)
		return problem ? { readOnly: false, reason: problem } : { readOnly: true, reason: "read-only" }
	}
	if (program === "find") {
		const bad = findAllowed(words.slice(1))
		return bad ? { readOnly: false, reason: `find ${bad} is not on the allow-list` } : { readOnly: true, reason: "read-only" }
	}
	const spec = PROGRAMS[program]
	if (spec === undefined) {
		return { readOnly: false, reason: `'${program}' is not on the read-only allowlist` }
	}
	if (spec !== "any") {
		const bad = flagsAllowed(words.slice(1), spec)
		if (bad) {
			return { readOnly: false, reason: `${program} ${bad} is not on the flag allow-list` }
		}
	}
	return { readOnly: true, reason: "read-only" }
}

/**
 * Host-side verdict: is this command read-only? Conservative: when in doubt, it is not. A pipeline qualifies only
 * if every segment does.
 */
export function classifyCommand(command: string, environment: ShellEnvironment = defaultEnvironment()): CommandClassification {
	if (environment.platform === "win32") {
		return { readOnly: false, reason: "Windows shells are not parsed; nothing is classified read-only" }
	}
	const shell = (environment.shell ?? "").split("/").pop() ?? ""
	if (!POSIX_SHELLS.has(shell)) {
		return {
			readOnly: false,
			reason: `shell '${shell || "unknown"}' is not a modelled POSIX shell; nothing is classified read-only`,
		}
	}
	const trimmed = command.trim()
	if (!trimmed) {
		return { readOnly: false, reason: "empty command" }
	}
	const segments = splitPipeline(trimmed)
	if (!segments) {
		return {
			readOnly: false,
			reason: "uses shell syntax the classifier does not model (separators, redirection, expansion, globbing, braces, comments or an unterminated quote)",
		}
	}
	for (const words of segments) {
		const verdict = classifySegment(words)
		if (!verdict.readOnly) {
			return verdict
		}
	}
	return { readOnly: true, reason: "read-only" }
}
