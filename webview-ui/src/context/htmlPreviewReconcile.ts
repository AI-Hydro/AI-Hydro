import type { HtmlPreviewItem } from "@shared/proto/cline/html_preview"

/**
 * A change that reached the webview (stream event or local edit) while a full
 * state snapshot request was still in flight.
 */
export type PreviewItemOp = { kind: "upsert"; item: HtmlPreviewItem } | { kind: "remove"; id: string } | { kind: "clear" }

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
	return laterOps.reduce(applyPreviewItemOp, [...snapshot])
}
