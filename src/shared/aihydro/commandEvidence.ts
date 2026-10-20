/**
 * Host evidence recorded on a command row (Wave 2 W2-0h): how the process ended, and why the host asked about it.
 *
 * Exit code: shell integration reports it when it can. When it cannot (no shell integration, terminal fallback, the
 * command was detached and is still running) the row records "unknown" and `execOutcome` is "unknown": the host never
 * assumes a command that returned output succeeded. Pure: no vscode, no imports beyond types.
 */

/** The process exit code, or "unknown" when the host could not observe it. */
export type CommandExit = number | "unknown"

/**
 * Why the host's command policy treats this command as noteworthy. Absent for the two unremarkable cases (the user's
 * "auto-run is off" setting asked, or the host classified the command read-only and ran it).
 */
export type CommandPolicyClass =
	| "subagent_launch" // an AI-Hydro CLI subagent launch: always asks
	| "protected_path" // touches a protected root: asks even under YOLO / execute-all
	| "auto_run_all" // ran under "Execute all commands" / YOLO (a danger grant)
	| "model_requested_approval" // the model asked for approval
	| "not_read_only" // the host could not classify the command read-only

export function execOutcomeForExit(exit: CommandExit | undefined): "completed" | "failed" | "unknown" {
	if (exit === undefined || exit === "unknown") {
		return "unknown"
	}
	return exit === 0 ? "completed" : "failed"
}

/** Model-facing sentence appended to a finished command's result; states the exit code or that it is unavailable. */
export function describeExit(exit: CommandExit | undefined): string {
	return exit === undefined || exit === "unknown" ? "exit code unavailable" : `exit code ${exit}`
}

/**
 * `execOutcome` to record on a call row when its result comes back. A command row is judged by its recorded exit code
 * (non-zero fails; unobserved is "unknown", never success); every other call is "completed" unless its result was an
 * error.
 */
export function execOutcomeFor(
	row: { type: "ask" | "say"; ask?: string; say?: string; exitCode?: CommandExit },
	toolErrored: boolean,
): "completed" | "failed" | "unknown" {
	if (toolErrored) {
		return "failed"
	}
	const kind = row.type === "ask" ? row.ask : row.say
	return kind === "command" ? execOutcomeForExit(row.exitCode) : "completed"
}
