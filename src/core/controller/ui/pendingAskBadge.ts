import { badgeForAsk } from "@shared/aihydro/pendingAsk"
import type { AiHydroAsk } from "@shared/ExtensionMessage"

/**
 * The sidebar view's "agent is waiting for you" badge and the `aihydro.hasPendingAsk` context key. Host-neutral:
 * the VS Code webview provider registers a sink that draws it. State lives here (not in the sink) so a view that is
 * re-resolved can redraw the current ask.
 *
 * `clearPending(ts)` is a no-op unless `ts` is the ask that is currently badged, so a late clear for an old ask
 * cannot wipe the badge of a newer one.
 */
export interface PendingAskBadge {
	ts: number
	ask: AiHydroAsk
	tooltip: string
}

type Sink = (pending: PendingAskBadge | undefined) => void

let current: PendingAskBadge | undefined
let sink: Sink | undefined

export function setPendingAskSink(fn: Sink | undefined): void {
	sink = fn
	// Apply what is already pending to a newly registered sink (view re-resolved).
	if (fn) {
		publish()
	}
}

export function getPendingAsk(): PendingAskBadge | undefined {
	return current
}

function publish(): void {
	try {
		sink?.(current)
	} catch (error) {
		console.warn("pendingAskBadge: sink failed", error)
	}
}

/** The agent is now blocked on `ask`. Asks that are not a mid-task block never mark. */
export function markPending(ts: number, ask: AiHydroAsk): void {
	const tooltip = badgeForAsk(ask)
	if (tooltip === undefined) {
		return
	}
	current = { ts, ask, tooltip }
	publish()
}

/** Clears the badge: for `ts` only when given (a stale clear is a no-op), unconditionally when omitted. */
export function clearPending(ts?: number): void {
	if (!current) {
		return
	}
	if (ts !== undefined && current.ts !== ts) {
		return
	}
	current = undefined
	publish()
}
