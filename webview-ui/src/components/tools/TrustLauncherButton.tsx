import { TOOLS_ACTION_LABEL } from "@shared/aihydro/toolsEnv"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { runToolsAction } from "./ToolsStatusChip"

export const TRUST_LAUNCHER_LABEL = TOOLS_ACTION_LABEL.trust

/**
 * Whether the named server is, right now, a connected first-party-shaped server the host has not trusted. Display only:
 * the host re-checks, and the only thing the button does is ask the host to show its confirmation dialog.
 */
export function useServerNeedsTrust(serverName: string | undefined): boolean {
	const { mcpServers } = useExtensionState()
	const server = (mcpServers ?? []).find((s) => s.name === serverName)
	// A server the webview has not heard of yet is not claimed trusted: the host's flag on the ask decides.
	return !server || (!server.disabled && server.trust?.trusted !== true)
}

/**
 * "Trust this launcher...": opens the host's modal confirmation (exact command and path). It never records trust
 * itself; declining the dialog changes nothing.
 */
export function TrustLauncherButton({ className, testId = "trust-launcher" }: { className?: string; testId?: string }) {
	return (
		<button
			className={
				className ??
				"inline-flex items-center min-h-[22px] px-2 rounded-sm border cursor-pointer text-[12px] border-[var(--vscode-button-border,transparent)] bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)]"
			}
			data-testid={testId}
			onClick={(e) => {
				e.stopPropagation()
				runToolsAction("trust")
			}}
			type="button">
			{TRUST_LAUNCHER_LABEL}
		</button>
	)
}

/** The action under a paused-auto-run line; gone once the server is trusted. */
export function PausedTrustAction({ serverName }: { serverName: string }) {
	return useServerNeedsTrust(serverName) ? (
		<div className="mt-1">
			<TrustLauncherButton testId="paused-trust-launcher" />
		</div>
	) : null
}
