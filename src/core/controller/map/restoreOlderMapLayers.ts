import { EmptyRequest } from "@shared/proto/cline/common"
import { RestoreOlderMapLayersResponse } from "@shared/proto/cline/map"
import type { Controller } from ".."

/** Loads the saved layers that were kept on disk but not restored at startup (older than the restore cap). */
export async function restoreOlderMapLayers(
	controller: Controller,
	_request: EmptyRequest,
): Promise<RestoreOlderMapLayersResponse> {
	const restored = await controller.restoreOlderMapLayers()
	return RestoreOlderMapLayersResponse.create({ restored })
}
