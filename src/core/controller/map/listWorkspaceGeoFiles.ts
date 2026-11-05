import { listProjectFiles } from "@core/map/projectFiles"
import type { EmptyRequest } from "@shared/proto/cline/common"
import type { ListWorkspaceGeoFilesResponse } from "@shared/proto/cline/map"
import type { Controller } from ".."

/**
 * Lists the map files of the open folders for the Project files tree. They are only candidates: nothing is registered as
 * a map layer until the user loads a file (decision D3). Files the user removed from the list on this machine come back
 * in `removed`, not in `files`. The list holds up to MAX_PROJECT_FILES; `truncated` says when the scan stopped there.
 */
export async function listWorkspaceGeoFiles(
	controller: Controller,
	_request: EmptyRequest,
): Promise<ListWorkspaceGeoFilesResponse> {
	return await listProjectFiles(controller.projectFilesHost())
}
