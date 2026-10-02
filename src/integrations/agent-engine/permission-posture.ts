import type { PermissionPosture } from "./types"

/**
 * Single place mapping our least-privilege PermissionPosture onto each CLI's
 * own safety knobs. Never emit claude's `bypassPermissions` or codex's
 * `danger-full-access` — if a caller needs more than scoped-write, that's a
 * new posture value here, not a one-off override at a call site.
 */

export function toClaudePermissionMode(posture: PermissionPosture): string {
	// acceptEdits still requires the model to stay within --add-dir; it does
	// not disable the sandbox, only the interactive confirmation prompt.
	return posture === "read-only" ? "plan" : "acceptEdits"
}

export interface CodexSandboxPosture {
	sandbox: "read-only" | "workspace-write"
	/** codex's approval prompt has no TTY to answer it in headless engine mode; "never" surfaces failures to the model instead of hanging. */
	approvalPolicy: "never"
}

export function toCodexSandboxPosture(posture: PermissionPosture): CodexSandboxPosture {
	return {
		sandbox: posture === "read-only" ? "read-only" : "workspace-write",
		approvalPolicy: "never",
	}
}
