import type { EmptyRequest } from "@shared/proto/cline/common"
import { ListWorkspaceGeoFilesResponse } from "@shared/proto/cline/map"
import type { Controller } from ".."

/** Cap on rows sent to the webview; `totalCount` keeps the list honest when it is exceeded. */
export const MAX_WORKSPACE_GEO_FILES_LISTED = 200

/**
 * Lists geo data files found in the workspace. They are only candidates: nothing is registered as a map layer
 * until the user adds a file (decision D3).
 */
export async function listWorkspaceGeoFiles(
	controller: Controller,
	_request: EmptyRequest,
): Promise<ListWorkspaceGeoFilesResponse> {
	const all = controller.getWorkspaceGeoJsonFiles()
	return ListWorkspaceGeoFilesResponse.create({
		files: all.slice(0, MAX_WORKSPACE_GEO_FILES_LISTED).map((file) => ({
			relativePath: file.relativePath,
			workspaceFolder: file.workspaceFolder,
			folderName: file.workspaceFolderName,
			name: file.name,
			extension: file.extension.toLowerCase(),
		})),
		totalCount: all.length,
	})
}
