/**
 * Defence in depth for a git command the host auto-runs as read-only (approval redesign AP1).
 *
 * The gate is workspace trust (readOnlyClassifier.ts): in an untrusted workspace git always asks. This hardening
 * runs only after that gate and only for POSIX shells (the classifier classifies nothing read-only elsewhere). It
 * overrides, at git's highest config precedence (`GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n`, which beats repository
 * config), the settings a hostile `.git/config` could use to run a program:
 *
 *   core.fsmonitor=false      no filesystem-monitor hook
 *   core.hooksPath=/dev/null  no hooks
 *   core.pager=cat            no pager program (and GIT_PAGER=cat, the `--no-pager` behaviour)
 *   core.sshCommand=          no ssh program
 *   protocol.allow=never      no transport helpers
 *   GIT_TERMINAL_PROMPT=0     never wait for credentials on the terminal
 *
 * The external diff driver and textconv drivers are neutralised per command instead of by config: an empty
 * `diff.external=` makes git try to run "" and fail (checked against real git), so `diff`, `log` and `show` get
 * `--no-ext-diff --no-textconv` through a shell function defined in the same subshell (it also forces `--no-pager`).
 *
 * It CANNOT neutralise `filter.<name>.clean|smudge|process` and `diff.<name>.textconv`: the driver names come from
 * `.gitattributes` and are arbitrary, so they cannot be enumerated. That is why workspace trust is the real gate and
 * this is only a second layer.
 *
 * The variables and the wrapper are defined inside a subshell, so they do not leak into the user's terminal session and later
 * commands (for example the user's own `git commit`, which should keep its hooks).
 */
export const GIT_HARDENING_CONFIG: ReadonlyArray<readonly [string, string]> = [
	["core.fsmonitor", "false"],
	["core.hooksPath", "/dev/null"],
	["core.pager", "cat"],
	["core.sshCommand", ""],
	["protocol.allow", "never"],
]

/** `NAME=value` assignments for the hardened git environment, in a stable order. */
export function gitHardeningAssignments(): string[] {
	const assignments = [`GIT_CONFIG_COUNT=${GIT_HARDENING_CONFIG.length}`]
	GIT_HARDENING_CONFIG.forEach(([key, value], i) => {
		assignments.push(`GIT_CONFIG_KEY_${i}=${key}`, `GIT_CONFIG_VALUE_${i}=${value}`)
	})
	assignments.push("GIT_PAGER=cat", "GIT_TERMINAL_PROMPT=0")
	return assignments
}

/**
 * POSIX shell function that makes every `git` in the subshell run `--no-pager`, and `diff`/`log`/`show` run
 * `--no-ext-diff --no-textconv`. `command git` bypasses the function, so it cannot recurse.
 */
export const GIT_WRAPPER_FUNCTION =
	'git() { while [ "$1" = --no-pager ]; do shift; done; case "$1" in diff|log|show) _s=$1; shift; command git --no-pager "$_s" --no-ext-diff --no-textconv "$@";; *) command git --no-pager "$@";; esac; }'

/** Wrap an already-classified read-only POSIX command so every git in it runs with the hardened environment. */
export function hardenGitEnvironment(command: string): string {
	return `( export ${gitHardeningAssignments().join(" ")}; ${GIT_WRAPPER_FUNCTION}; ${command} )`
}
