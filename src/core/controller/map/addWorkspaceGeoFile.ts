import { AddWorkspaceGeoFileResponse, type AddWorkspaceGeoFileRequest } from "@shared/proto/cline/map"
import type { Controller } from ".."

/** Load: adds one user-chosen project file to the map as a layer, giving back the settings it had when it was last unloaded. */
export async function addWorkspaceGeoFile(
	controller: Controller,
	request: AddWorkspaceGeoFileRequest,
): Promise<AddWorkspaceGeoFileResponse> {
	const { layerId, kept, sizeBytes } = await controller.addWorkspaceGeoFileByPath(request.relativePath, request.workspaceFolder)
	return AddWorkspaceGeoFileResponse.create({
		layerId,
		sizeBytes,
		settingsRestored: kept !== undefined,
		hasOpacity: typeof kept?.opacity === "number",
		opacity: kept?.opacity ?? 0,
		hidden: kept?.hidden === true,
		positionFromTop: kept?.position_from_top ?? -1,
	})
}
