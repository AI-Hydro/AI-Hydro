import type { ProjectKey } from "@core/project/projectIdentity"
import type { ScanStats, WorkspaceGeoJsonFile } from "@core/workspace/FileScanner"
import {
	type FileListChangeRequest,
	ListWorkspaceGeoFilesResponse,
	type RemovedFileEntry,
	type WorkspaceGeoFile,
} from "@shared/proto/cline/map"
import { PROJECT_FILE_EXTENSIONS } from "@shared/map/projectFiles"
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
	/**
	 * The id of the layer on the map that was made from this file, comparing real paths (symlinks resolved), so a symlinked
	 * folder, or `/var` against `/private/var`, still counts as loaded. Undefined when the file is not on the map.
	 */
	loadedLayerId?(absolutePath: string): string | undefined
}

const toProtoFile = (file: WorkspaceGeoJsonFile, loadedLayerId = ""): WorkspaceGeoFile => ({
	loadedLayerId,
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
		files: visible.map((file) => toProtoFile(file, host.loadedLayerId?.(file.uri.fsPath) ?? "")),
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

/**
 * The check on a "load this project file" message from the webview (GeoTIFF, KMZ: the map panel parses them). The file
 * is named by an open folder and a relative path, and must be exactly a file of the current scan: no `..`, no absolute or
 * drive path, a listed geo extension, and a row of the list. Returns the file's absolute path, or why not.
 */
export function checkProjectFileRequest(
	request: { workspaceFolder?: unknown; relativePath?: unknown },
	scan: { workspaceFolder: string; relativePath: string; extension: string }[],
	folders: { path: string }[],
): { ok: true; absolutePath: string } | { ok: false; reason: string } {
	const rel = request.relativePath
	const folder = request.workspaceFolder
	if (typeof rel !== "string" || typeof folder !== "string" || rel === "") {
		return { ok: false, reason: "That file is not in an open folder." }
	}
	const normal = normalizeRelative(rel)
	if (path.isAbsolute(rel) || path.isAbsolute(normal) || /^[A-Za-z]:/.test(rel) || normal.split("/").includes("..") || rel.includes("\0")) {
		return { ok: false, reason: "A project file is named by a path inside its folder." }
	}
	if (!folders.some((f) => f.path === folder)) {
		return { ok: false, reason: "That file is not in an open folder." }
	}
	const ext = path.extname(normal).toLowerCase()
	if (!(PROJECT_FILE_EXTENSIONS as readonly string[]).includes(ext.slice(1))) {
		return { ok: false, reason: "That is not a map file type." }
	}
	const listed = scan.find((f) => f.workspaceFolder === folder && normalizeRelative(f.relativePath) === normal)
	if (!listed) {
		return { ok: false, reason: "That file is not in the Project files list." }
	}
	return { ok: true, absolutePath: path.join(folder, normal) }
}
