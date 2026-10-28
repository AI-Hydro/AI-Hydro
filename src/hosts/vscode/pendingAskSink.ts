import type { PendingAskBadge } from "@core/controller/ui/pendingAskBadge"

/** The context key `aihydro.focusPendingPrompt` is enabled by (package.json `when`). */
export const HAS_PENDING_ASK_CONTEXT = "aihydro.hasPendingAsk"

/** The part of vscode.WebviewView the badge needs. */
export interface BadgeTarget {
	badge?: { value: number; tooltip: string } | undefined
}

/**
 * Draws the pending-ask state: the sidebar view badge (shown whether or not the view is visible) and the context
 * key. `setContext` is injected so this stays free of the `vscode` runtime and testable.
 */
export function applyPendingAsk(
	target: BadgeTarget | undefined,
	pending: PendingAskBadge | undefined,
	setContext: (key: string, value: boolean) => void | Thenable<unknown>,
): void {
	if (target) {
		target.badge = pending ? { value: 1, tooltip: pending.tooltip } : undefined
	}
	void setContext(HAS_PENDING_ASK_CONTEXT, !!pending)
}
