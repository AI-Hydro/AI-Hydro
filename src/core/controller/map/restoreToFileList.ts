import { changeFileList } from "@core/map/projectFiles"
import { FileListChangeResponse, type FileListChangeRequest } from "@shared/proto/cline/map"
import type { Controller } from ".."

/** Restore: puts removed entries back in the Project files tree (all of them, or the ones named). */
export async function restoreToFileList(controller: Controller, request: FileListChangeRequest): Promise<FileListChangeResponse> {
	return FileListChangeResponse.create({ changed: await changeFileList(controller.projectFilesHost(), request, "restore") })
}
