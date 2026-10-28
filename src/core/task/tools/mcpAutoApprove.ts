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
import { isServerTrusted } from "@shared/aihydro/firstPartyServers"
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
	| { auto: false; granted: true; reason: AlwaysAllowRefusalReason; pausedText: string }

export function mcpAutoApproveDecision(
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
	return { auto: false, granted: true, reason: verdict.reason, pausedText: alwaysPausedText(toolName, verdict.reason) }
}

/** True only when the call may run without asking: a stored grant that also passes the run-time recheck. */
export function isMcpToolGrantedAutoApprove(
	hub: ConnectionsView | undefined,
	serverName: string | undefined,
	toolName: string | undefined,
): boolean {
	return mcpAutoApproveDecision(hub, serverName, toolName).auto
}
