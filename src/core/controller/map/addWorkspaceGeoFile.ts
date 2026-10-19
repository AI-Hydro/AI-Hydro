import { AddWorkspaceGeoFileResponse, type AddWorkspaceGeoFileRequest } from "@shared/proto/cline/map"
import type { Controller } from ".."

/** Adds one user-chosen workspace geo file to the map as a layer. */
export async function addWorkspaceGeoFile(
	controller: Controller,
	request: AddWorkspaceGeoFileRequest,
): Promise<AddWorkspaceGeoFileResponse> {
	const layerId = await controller.addWorkspaceGeoFileByPath(request.relativePath)
	return AddWorkspaceGeoFileResponse.create({ layerId })
}
