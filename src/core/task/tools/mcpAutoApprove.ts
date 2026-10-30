/**
 * Whether a use_mcp_tool call may run without asking. The ONE place the handler reads it, so a test can assert the
 * real decision against settings the host actually wrote.
 *
 * Two inputs, both from the host's own view of the connection (never the model or the webview):
 *  - the stored grant: `tool.autoApprove`, set from the policy-accepted settings only (McpHub.markAutoApprove);
 *  - the live recheck (M-3): `alwaysAllowVerdict` against the connection as it is NOW. A grant counts only while the
 *    server is still trusted (isServerTrusted: launcher identity), connected, lists the tool exactly once, and the
 *    tool's effect class is READ, WRITE or NETWORK. Anything else falls back to asking, and the reason is returned
 *    so the ask can say why. Fail closed. The stored grant is never deleted here: it resumes by itself if the
 *    conditions hold again.
 */
import { type AlwaysAllowRefusalReason, alwaysAllowVerdict, alwaysPausedText } from "@shared/aihydro/alwaysAllowPolicy"
import { canOfferTrustAction, isServerTrusted, launchLineOfConfig } from "@shared/aihydro/firstPartyServers"
import type { EffectAnnotations } from "@shared/aihydro/mcpEffectClass"

interface ConnectionsView {
	connections?: {
		server: {
			name: string
			config?: string
			status?: string
			tools?: { name: string; autoApprove?: boolean; annotations?: EffectAnnotations | null }[]
		}
	}[]
}

export type McpAutoApproveDecision =
	| { auto: true }
	| { auto: false; granted: false }
	/** A stored grant exists but fails the run-time recheck: ask, and say why. */
	| { auto: false; granted: true; reason: AlwaysAllowRefusalReason | "check_failed"; pausedText: string }

export function mcpAutoApproveDecision(
	hub: ConnectionsView | undefined,
	serverName: string | undefined,
	toolName: string | undefined,
): McpAutoApproveDecision {
	// Fail closed: anything unexpected while deciding means ask, never run.
	try {
		return decide(hub, serverName, toolName)
	} catch {
		return {
			auto: false,
			granted: true,
			reason: "check_failed",
			pausedText: `Always for ${toolName ?? "this tool"} is paused: it could not be checked just now.`,
		}
	}
}

function decide(
	hub: ConnectionsView | undefined,
	serverName: string | undefined,
	toolName: string | undefined,
): McpAutoApproveDecision {
	const server = hub?.connections?.find((conn) => conn.server.name === serverName)?.server
	if (!server || !toolName || server.tools?.find((tool) => tool.name === toolName)?.autoApprove !== true) {
		return { auto: false, granted: false }
	}
	const verdict = alwaysAllowVerdict({
		serverTrusted: isServerTrusted(server),
		serverConnected: server.status === "connected",
		tools: server.tools,
		toolName,
	})
	if (verdict.ok) {
		return { auto: true }
	}
	return {
		auto: false,
		granted: true,
		reason: verdict.reason,
		pausedText: alwaysPausedText(toolName, verdict.reason, launchLineOfConfig(server.config)),
	}
}

/** True only when the call may run without asking: a stored grant that also passes the run-time recheck. */
export function isMcpToolGrantedAutoApprove(
	hub: ConnectionsView | undefined,
	serverName: string | undefined,
	toolName: string | undefined,
): boolean {
	return mcpAutoApproveDecision(hub, serverName, toolName).auto
}

/**
 * What a call is bound to: whether the live connection is the trusted one, and its launch configuration. Captured
 * when the decision is taken and compared immediately before callTool (which looks the connection up again by
 * name), so a server swapped in between can neither inherit an auto-run nor an approval given for another one.
 * Undefined when there is no such connection.
 */
export function mcpConnectionIdentity(hub: ConnectionsView | undefined, serverName: string | undefined): string | undefined {
	try {
		const server = hub?.connections?.find((conn) => conn.server.name === serverName)?.server
		return server ? `${isServerTrusted(server)}|${server.config ?? ""}` : undefined
	} catch {
		return undefined
	}
}

/** Neutral reason shown when a resource read asks instead of auto-running. */
export const UNTRUSTED_AUTO_RUN_TEXT = "Auto-run is off for this server because AI-Hydro has not confirmed where it runs from."

/** access_mcp_resource may auto-run only against a live connection that is the trusted first-party server. */
export function mcpResourceAutoRunAllowed(hub: ConnectionsView | undefined, serverName: string | undefined): boolean {
	try {
		const server = hub?.connections?.find((conn) => conn.server.name === serverName)?.server
		return !!server && isServerTrusted(server)
	} catch {
		return false
	}
}

/**
 * The one-click fix an ask offers beside its paused-auto-run line: "Trust this launcher..." (opens the host's modal;
 * the webview cannot trust anything itself). Only for a first-party-named server whose auto-run is paused by trust.
 */
export function pausedFixFor(
	serverName: string | undefined,
	reason: AlwaysAllowRefusalReason | "check_failed",
): "trust_launcher" | undefined {
	return reason === "untrusted_server" && canOfferTrustAction(serverName) ? "trust_launcher" : undefined
}

/** The fix for a resource read that asks because the server is not trusted: only for a connected first-party-named server. */
export function resourcePausedFix(
	hub: ConnectionsView | undefined,
	serverName: string | undefined,
): "trust_launcher" | undefined {
	try {
		const server = hub?.connections?.find((conn) => conn.server.name === serverName)?.server
		return server?.status === "connected" && !isServerTrusted(server)
			? pausedFixFor(serverName, "untrusted_server")
			: undefined
	} catch {
		return undefined
	}
}
