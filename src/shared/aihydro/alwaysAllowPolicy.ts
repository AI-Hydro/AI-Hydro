/**
 * Which MCP tools may be put on a server's auto-approve ("Always") list. Pure and host-free: the extension host
 * (McpHub.toggleToolAutoApproveRPC) enforces it and the settings UI mirrors it, so the two cannot drift.
 *
 * The rule is the M7 rule: tool annotations are hints from the server and count ONLY when the server is trusted
 * (isServerTrusted). A grant is allowed when the server is trusted and connected, the tool is listed exactly once
 * under exactly that name, and its effect class is READ, WRITE or NETWORK. DESTRUCTIVE and UNKNOWN never are.
 * For an untrusted server annotations are never read: the verdict is `untrusted_server` whatever they declare.
 *
 * Removing a grant tightens policy and is never checked here.
 */
import { type EffectAnnotations, effectClass } from "./mcpEffectClass"

export type AlwaysAllowRefusalReason =
	| "untrusted_server"
	| "server_unavailable"
	| "unknown_tool"
	| "destructive"
	| "unknown_effect"

export type AlwaysAllowVerdict = { ok: true } | { ok: false; reason: AlwaysAllowRefusalReason }

export interface AlwaysAllowTool {
	name: string
	annotations?: EffectAnnotations | null
}

export interface AlwaysAllowInput {
	/** isServerTrusted(connection), computed by the caller from the resolved connection. */
	serverTrusted: boolean
	serverConnected: boolean
	/** The server's listed tools. */
	tools: readonly AlwaysAllowTool[] | undefined
	/** Exact, case-sensitive tool name being granted. */
	toolName: string
}

export function alwaysAllowVerdict(input: AlwaysAllowInput): AlwaysAllowVerdict {
	if (!input.serverTrusted) {
		return { ok: false, reason: "untrusted_server" }
	}
	if (!input.serverConnected) {
		return { ok: false, reason: "server_unavailable" }
	}
	const matches = (input.tools ?? []).filter((t) => t.name === input.toolName)
	// Absent, or ambiguous (a name listed twice cannot be tied to one set of annotations).
	if (matches.length !== 1) {
		return { ok: false, reason: "unknown_tool" }
	}
	const cls = effectClass(matches[0].annotations)
	switch (cls) {
		case "READ":
		case "WRITE":
		case "NETWORK":
			return { ok: true }
		case "DESTRUCTIVE":
			return { ok: false, reason: "destructive" }
		case "UNKNOWN":
			return { ok: false, reason: "unknown_effect" }
		default: {
			const unreachable: never = cls
			void unreachable
			return { ok: false, reason: "unknown_effect" }
		}
	}
}

/** Text for the settings UI. The untrusted reason names the trust requirement. */
export function alwaysAllowReasonText(reason: AlwaysAllowRefusalReason): string {
	switch (reason) {
		case "untrusted_server":
			return "Not available: only the registered first-party AI-Hydro server can be auto-approved. This server is not the registered first-party server, so what it says about its tools is not trusted."
		case "server_unavailable":
			return "Not available: the server is not connected."
		case "unknown_tool":
			return "Not available: the server does not list this tool exactly once."
		case "destructive":
			return "Not available: the server declares this tool may be destructive."
		case "unknown_effect":
			return "Not available: the server does not declare what this tool does (effect not declared)."
		default: {
			const unreachable: never = reason
			return String(unreachable)
		}
	}
}

// ── Refusal wire format (host throws, webview parses) ──────────────────────

export const AUTO_APPROVE_REFUSED_PREFIX = "AIHYDRO_AUTO_APPROVE_REFUSED "

export interface AutoApproveRefusal {
	server: string
	refused: { tool: string; reason: AlwaysAllowRefusalReason }[]
}

const REASONS: readonly AlwaysAllowRefusalReason[] = [
	"untrusted_server",
	"server_unavailable",
	"unknown_tool",
	"destructive",
	"unknown_effect",
]

export function formatAutoApproveRefusal(refusal: AutoApproveRefusal): string {
	return AUTO_APPROVE_REFUSED_PREFIX + JSON.stringify(refusal)
}

/** Finds the refusal anywhere in the message (gRPC wrappers may prefix it); undefined when absent or malformed. */
export function parseAutoApproveRefusal(message: string | undefined): AutoApproveRefusal | undefined {
	if (!message) {
		return undefined
	}
	const at = message.indexOf(AUTO_APPROVE_REFUSED_PREFIX)
	if (at < 0) {
		return undefined
	}
	try {
		const parsed = JSON.parse(message.slice(at + AUTO_APPROVE_REFUSED_PREFIX.length))
		if (!parsed || typeof parsed.server !== "string" || !Array.isArray(parsed.refused)) {
			return undefined
		}
		const refused = parsed.refused.filter(
			(r: any) => r && typeof r.tool === "string" && REASONS.includes(r.reason),
		) as AutoApproveRefusal["refused"]
		if (refused.length !== parsed.refused.length || refused.length === 0) {
			return undefined
		}
		return { server: parsed.server, refused }
	} catch {
		return undefined
	}
}

/** One inline sentence for a parsed refusal. */
export function describeAutoApproveRefusal(refusal: AutoApproveRefusal): string {
	const first = refusal.refused[0]
	const more = refusal.refused.length > 1 ? ` (and ${refusal.refused.length - 1} more)` : ""
	return `${first.tool}${more}: ${alwaysAllowReasonText(first.reason)} Nothing was changed.`
}

// ── Bulk "Auto-run all tools" control state (settings panel) ───────────────

export interface BulkAutoRunTool extends AlwaysAllowTool {
	autoApprove?: boolean
}

export interface BulkAutoRunState {
	/** Shown checked: every eligible tool is granted, or (nothing eligible) some legacy grant exists. */
	checked: boolean
	/** Only an ADD can be impossible: nothing is eligible and nothing is granted. Revoking is never disabled. */
	disabled: boolean
	/** What a click requests. Enabling sends eligible tools only; disabling sends every granted-or-listed tool. */
	enabling: boolean
	toolNames: string[]
}

export function bulkAutoRunState(input: {
	serverTrusted: boolean
	serverConnected: boolean
	tools: readonly BulkAutoRunTool[] | undefined
}): BulkAutoRunState {
	const tools = input.tools ?? []
	const eligible = tools.filter(
		(t) =>
			alwaysAllowVerdict({
				serverTrusted: input.serverTrusted,
				serverConnected: input.serverConnected,
				tools,
				toolName: t.name,
			}).ok,
	)
	const granted = tools.filter((t) => t.autoApprove)
	const checked = eligible.length > 0 ? eligible.every((t) => t.autoApprove) : granted.length > 0
	const enabling = !checked
	return {
		checked,
		disabled: enabling && eligible.length === 0,
		enabling,
		toolNames: (enabling ? eligible : tools).map((t) => t.name),
	}
}
