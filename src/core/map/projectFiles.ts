import type { ProjectKey } from "@core/project/projectIdentity"
import type { ScanStats, WorkspaceGeoJsonFile } from "@core/workspace/FileScanner"
import {
	type FileListChangeRequest,
	ListWorkspaceGeoFilesResponse,
	type RemovedFileEntry,
	type WorkspaceGeoFile,
} from "@shared/proto/cline/map"
import * as path from "path"
import {
	addRemoved,
	type FileListStateStore,
	folderHashOf,
	indexRemoved,
	normalizeRelative,
	readRemoved,
	restoreRemoved,
} from "./mapFileListStore"

/**
 * What the Layers panel's Project files tree is built from: the scan's files, minus the ones the user removed from the
 * list on this machine, plus the removed entries themselves (so they can be restored).
 *
 * "Remove from list" and "Restore" only edit the list in `globalState`. Nothing here opens, moves or deletes a file.
 */

export interface ProjectFilesHost {
	files(): WorkspaceGeoJsonFile[]
	stats(): ScanStats
	folders(): { path: string; name: string }[]
	/** The open project's list scope. One identity for the whole window, however many folders it holds. */
	scope(): Promise<{ store: FileListStateStore; key: ProjectKey; dirKey?: string }>
}

const toProtoFile = (file: WorkspaceGeoJsonFile): WorkspaceGeoFile => ({
	relativePath: file.relativePath,
	workspaceFolder: file.workspaceFolder,
	folderName: file.workspaceFolderName,
	name: file.name,
	extension: file.extension.toLowerCase(),
	sizeBytes: file.sizeBytes ?? 0,
	mtimeMs: Math.round(file.lastModified ?? 0),
})

export async function listProjectFiles(host: ProjectFilesHost): Promise<ListWorkspaceGeoFilesResponse> {
	const { store, key, dirKey } = await host.scope()
	const removed = await readRemoved(store, key, { dirKey })
	const hashes = new Map<string, string>()
	for (const folder of host.folders()) hashes.set(folder.path, await folderHashOf(folder.path))
	const index = indexRemoved(removed)
	const files = host.files()
	const visible = files.filter((file) => {
		const hash = hashes.get(file.workspaceFolder)
		return !hash || !index.has(hash, file.relativePath)
	})
	const byHash = new Map<string, { path: string; name: string }>()
	for (const folder of host.folders()) byHash.set(hashes.get(folder.path) ?? "", folder)
	const removedRows: RemovedFileEntry[] = removed.map((entry) => {
		const folder = byHash.get(entry.folderHash)
		return {
			relativePath: entry.relativePath,
			workspaceFolder: folder?.path ?? "",
			folderName: folder?.name ?? "",
			name: path.posix.basename(entry.relativePath),
			kind: entry.kind,
			removedAt: entry.removedAt,
		}
	})
	const stats = host.stats()
	return ListWorkspaceGeoFilesResponse.create({
		files: visible.map(toProtoFile),
		totalCount: visible.length,
		foldersSkipped: stats.foldersSkipped,
		skippedNames: stats.skippedNames,
		symlinksFound: stats.symlinksFound,
		symlinksSkipped: stats.symlinksSkipped,
		truncated: stats.truncated,
		removed: removedRows,
		folderCount: stats.folderCount,
	})
}

/** Add to, or take from, the removed list. Entries for a folder this window does not have open are ignored. */
export async function changeFileList(
	host: ProjectFilesHost,
	request: FileListChangeRequest,
	mode: "remove" | "restore",
): Promise<number> {
	const { store, key, dirKey } = await host.scope()
	// Settle any pending `dir:` -> `prj_` move before writing.
	await readRemoved(store, key, { dirKey })
	if (mode === "restore" && request.all) return await restoreRemoved(store, key.key, "all")
	const entries: { folderHash: string; relativePath: string; kind: "file" | "folder" }[] = []
	for (const entry of request.entries ?? []) {
		const folder = host.folders().find((f) => f.path === entry.workspaceFolder)
		if (!folder) continue
		entries.push({
			folderHash: await folderHashOf(folder.path),
			relativePath: normalizeRelative(entry.relativePath),
			kind: entry.kind === "folder" ? "folder" : "file",
		})
	}
	return mode === "remove" ? await addRemoved(store, key.key, entries) : await restoreRemoved(store, key.key, entries)
}
