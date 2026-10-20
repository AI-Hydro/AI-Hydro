/**
 * Identity and containment rules for workspace geo files.
 *
 * Multi-root workspaces can hold the same relative path in two folders, so a file is identified by its workspace
 * folder AND its relative path. Listed files must also really live inside their folder: a symlink inside the
 * workspace that points elsewhere (another project, a home directory) is not a workspace file.
 */
import * as fs from "fs/promises"
import * as path from "path"

/** Stable key for a workspace geo file: workspace folder path plus folder-relative path. */
export function workspaceGeoFileKey(workspaceFolder: string, relativePath: string): string {
	return `${workspaceFolder}\u0000${relativePath}`
}

/** True when `child` is `parent` or lies beneath it (both absolute, already resolved). */
export function isPathInside(parent: string, child: string): boolean {
	const relative = path.relative(parent, child)
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

/**
 * Resolves symlinks for the file and its folder and returns the file's real path when it stays inside the
 * folder, otherwise null (also null when either path cannot be resolved).
 */
export async function realPathInsideFolder(workspaceFolder: string, filePath: string): Promise<string | null> {
	try {
		const [realFolder, realFile] = await Promise.all([fs.realpath(workspaceFolder), fs.realpath(filePath)])
		return isPathInside(realFolder, realFile) ? realFile : null
	} catch {
		return null
	}
}
