import { HtmlPreviewStateRequest, HtmlPreviewStateResponse } from "@shared/proto/cline/html_preview"
import type { Controller } from ".."

/**
 * Current HTML preview state, without the content the requester already holds.
 *
 * Every state change makes the Studio shell ask for a snapshot, and a snapshot used to carry the full HTML of
 * every document opened so far (about 1.9 MB each for a book module), so the bytes moved grew with the square of
 * the modules opened. The requester now lists the (id, content hash) pairs it holds; for an item that matches
 * on both, `htmlContent` is left empty and `metadata.contentOmitted` is "true", and the requester keeps the
 * content it already has. An item whose hash differs, or that the requester does not hold, is sent in full, so
 * the document a shell renders is always the bytes the host hashed and trust-checked.
 */
export async function getHtmlPreviewStateSince(
	controller: Controller,
	request: HtmlPreviewStateRequest,
): Promise<HtmlPreviewStateResponse> {
	console.log("[getHtmlPreviewStateSince] Retrieving current HTML preview state")

	const held = new Map<string, string>()
	for (const known of request.known) {
		if (known.id && known.contentHash) held.set(known.id, known.contentHash)
	}
	const items = controller
		.getHtmlPreviews()
		.map((item) =>
			item.htmlContent && item.contentHash && held.get(item.id) === item.contentHash
				? { ...item, htmlContent: "", metadata: { ...item.metadata, contentOmitted: "true" } }
				: item,
		)
	// Counts only (no content): lets a test or a log reader see how many bytes a snapshot carried.
	const contentBytes = items.reduce((sum, i) => sum + i.htmlContent.length, 0)
	const omitted = items.filter((i) => i.metadata.contentOmitted === "true").length
	console.log(`[getHtmlPreviewStateSince] sent items=${items.length} omitted=${omitted} contentBytes=${contentBytes}`)
	return HtmlPreviewStateResponse.create({ items, itemCount: items.length })
}
