import type { EmptyRequest } from "@shared/proto/cline/common"
import type { LearningModuleCatalog } from "@shared/proto/cline/html_preview"
import type { Controller } from "../index"

/**
 * A fetch failure must reach the webview as an RPC error (so it can show an
 * error state with Retry), never as an empty catalogue. An empty catalogue is
 * returned only when the index genuinely lists no items.
 */
export async function refreshModulesMarketplace(controller: Controller, _request: EmptyRequest): Promise<LearningModuleCatalog> {
	const catalog = await controller.silentlyRefreshModulesMarketplaceRPC()
	if (!catalog) {
		throw new Error("Could not load the modules catalogue. Check your connection and retry.")
	}
	return catalog as LearningModuleCatalog
}
