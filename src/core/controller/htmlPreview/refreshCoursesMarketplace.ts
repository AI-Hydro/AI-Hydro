import type { EmptyRequest } from "@shared/proto/cline/common"
import type { CourseCatalog } from "@shared/proto/cline/html_preview"
import type { Controller } from "../index"

/**
 * A fetch failure must reach the webview as an RPC error (so it can show an
 * error state with Retry), never as an empty catalogue. An empty catalogue is
 * returned only when the index genuinely lists no items.
 */
export async function refreshCoursesMarketplace(controller: Controller, _request: EmptyRequest): Promise<CourseCatalog> {
	const catalog = await controller.silentlyRefreshCoursesMarketplaceRPC()
	if (!catalog) {
		throw new Error("Could not load the courses catalogue. Check your connection and retry.")
	}
	return catalog as CourseCatalog
}
