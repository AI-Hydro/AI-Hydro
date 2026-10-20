/**
 * Structured evidence on `say: "info"` rows (Wave 2 W2-0h).
 *
 * Today an `info` row is a muted plain string; the transcript presenter cannot tell "malformed tool call; retried"
 * (always worth showing) from a routine status line without string-matching. The host now records WHICH kind of notice
 * it is and how serious. The human-readable text stays in `message.text` unchanged, so an old task (plain-string
 * `info`, no `infoNotice`) renders exactly as before and is classified by the presenter's legacy-prefix registry.
 *
 * W2-0's `transcriptContracts.ts` registry should import `InfoNotice`/`InfoClass`/`InfoSeverity` from here (or this
 * file re-exports from there): whichever PR merges second reconciles. Pure types and constants, no imports.
 */

export type InfoSeverity = "info" | "warning"

/** Every notice class the host emits. Add a class here first; the presenter treats an unknown class as lifted. */
export const INFO_CLASSES = [
	"context_truncated",
	"malformed_tool_call",
	"native_call_not_run",
	"native_call_repaired",
	"unknown_tool",
	"server_not_connected",
] as const

export type InfoClass = (typeof INFO_CLASSES)[number]

/** Machine-readable specifics of a notice (counts, ranges); the words stay in `message.text`. */
export type InfoDetail = Record<string, number | string | number[]>

export interface InfoNotice {
	class: InfoClass
	severity: InfoSeverity
	/** Optional specifics, e.g. the deleted history range and counts for `context_truncated`. */
	detail?: InfoDetail
}

/** Severity of each class; the single source so an emission site cannot disagree with the registry. */
export const INFO_CLASS_SEVERITY: Record<InfoClass, InfoSeverity> = {
	context_truncated: "warning",
	malformed_tool_call: "warning",
	native_call_not_run: "warning",
	native_call_repaired: "info",
	unknown_tool: "warning",
	server_not_connected: "warning",
}

export function infoNoticeFor(infoClass: InfoClass, detail?: InfoDetail): InfoNotice {
	return detail
		? { class: infoClass, severity: INFO_CLASS_SEVERITY[infoClass], detail }
		: { class: infoClass, severity: INFO_CLASS_SEVERITY[infoClass] }
}

/** Level an MCP server attached to a notification (RFC 5424 names, as in the MCP logging capability). */
export type McpNotificationLevel = "debug" | "info" | "notice" | "warning" | "error" | "critical" | "alert" | "emergency"

const QUIET: readonly string[] = ["debug", "info", "notice"]

/**
 * Warning and above: the presenter lifts these and the row uses the warning style. A missing level is an old row
 * (quiet); a non-empty level we do not recognise is elevated, so it is lifted rather than folded away.
 */
export function isElevatedMcpLevel(level: string | undefined): boolean {
	return level !== undefined && level !== "" && !QUIET.includes(level)
}

/** Host-recorded evidence a `say` may attach to its row (spread onto the message; absent = none recorded). */
export interface SayEvidence {
	infoNotice?: InfoNotice
	mcpLevel?: McpNotificationLevel
}
