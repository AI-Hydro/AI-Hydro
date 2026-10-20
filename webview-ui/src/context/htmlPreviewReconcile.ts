import type { HtmlPreviewItem } from "@shared/proto/cline/html_preview"

/**
 * A change that reached the webview (stream event or local edit) while a full
 * state snapshot request was still in flight.
 */
export type PreviewItemOp = { kind: "upsert"; item: HtmlPreviewItem } | { kind: "remove"; id: string } | { kind: "clear" }

/**
 * Items carry no version, so when an upsert replaces an item that is already present and the
 * two disagree on the execution allowance, order cannot tell which is newer. Fail safe: a
 * revoked allowance on either side wins, so a replayed older "allowed" item never re-displays
 * a revoked document as allowed. (This is display only; the host enforces the allowance on
 * every run.)
 */
function mergeAllowance(existing: HtmlPreviewItem, incoming: HtmlPreviewItem): HtmlPreviewItem {
	if (existing.metadata?.executionAllowed === "false" && incoming.metadata?.executionAllowed === "true") {
		return { ...incoming, metadata: { ...incoming.metadata, executionAllowed: "false" } }
	}
	return incoming
}

export function applyPreviewItemOp(items: HtmlPreviewItem[], op: PreviewItemOp): HtmlPreviewItem[] {
	switch (op.kind) {
		case "clear":
			return []
		case "remove":
			return items.filter((i) => i.id !== op.id)
		case "upsert": {
			const idx = items.findIndex((i) => i.id === op.item.id)
			if (idx < 0) {
				return [...items, op.item]
			}
			const next = [...items]
			next[idx] = op.item
			return next
		}
	}
}

/**
 * Reconcile a full-state response with the changes that arrived after the
 * request was issued.
 *
 * The host takes its snapshot when it handles the request, but the response is
 * delivered asynchronously. A stream event (the host registering or removing a
 * preview) can therefore reach the webview before an older snapshot does.
 * Replacing the list with that snapshot would silently discard the newer
 * change, e.g. leave the panel on "no previews" after the host streamed the
 * document. Replaying the later operations over the snapshot keeps them.
 */
export function reconcileSnapshot(snapshot: HtmlPreviewItem[], laterOps: readonly PreviewItemOp[]): HtmlPreviewItem[] {
	const snapshotById = new Map(snapshot.map((i) => [i.id, i]))
	return laterOps.reduce(
		(items, op) => {
			if (op.kind !== "upsert") {
				return applyPreviewItemOp(items, op)
			}
			// Only compared against the snapshot's own copy: live stream updates apply as-is (a
			// genuine re-allow still shows), and a later op in the replay supersedes an earlier one.
			// See mergeAllowance for the fail-safe rule.
			const fromSnapshot = snapshotById.get(op.item.id)
			return applyPreviewItemOp(items, {
				kind: "upsert",
				item: fromSnapshot ? mergeAllowance(fromSnapshot, op.item) : op.item,
			})
		},
		[...snapshot],
	)
}
