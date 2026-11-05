import { changeFileList } from "@core/map/projectFiles"
import { FileListChangeResponse, type FileListChangeRequest } from "@shared/proto/cline/map"
import type { Controller } from ".."

/**
 * Remove from list: hides files or folders in the Project files tree on this machine. It edits a per-project list in the
 * extension's global state and nothing else. No file is opened, moved or deleted.
 */
export async function removeFromFileList(
	controller: Controller,
	request: FileListChangeRequest,
): Promise<FileListChangeResponse> {
	return FileListChangeResponse.create({ changed: await changeFileList(controller.projectFilesHost(), request, "remove") })
}
