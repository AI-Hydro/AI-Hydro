import * as path from "node:path"

export interface MapFilePathDeps {
	/** The user's home, for `~`. */
	homedir: string
	/** Workspace folder paths, in the order VS Code lists them. */
	workspaceFolders: string[]
	/** AI-Hydro's own directories (the layer cache), searched only for a `cache` path. */
	cacheDirs: string[]
	/** True when a file exists at this absolute path. */
	exists: (absolutePath: string) => Promise<boolean>
}

/**
 * What a path is, as the layer that holds it knows:
 *   - `project`: a file in the user's project (a layer's `source_path`, `path`, `workspace_path`). It is looked for in the
 *     layer's own folder, or the workspace folders, and nowhere else.
 *   - `cache`: a copy AI-Hydro made (`geojson_cache_path`, `display_geojson_path`). It is looked for in AI-Hydro's
 *     directories and nowhere else.
 *   - `any`: the caller does not know (photos, rasters, a scene). Project first, then the cache directories.
 * A cache copy shares its name with the project file it was made from and can be older, so a project path is never
 * answered with one and a cache path is never answered with a project file.
 */
export type MapPathKind = "project" | "cache" | "any"

function expandHome(filePath: string, homedir: string): string {
	if (filePath === "~") return homedir
	if (filePath.startsWith("~/")) return path.join(homedir, filePath.slice(2))
	return filePath
}

export async function resolveMapFilePath(
	filePath: string,
	deps: MapFilePathDeps,
	options: { workspaceFolder?: string; kind?: MapPathKind } = {},
): Promise<string> {
	const expanded = expandHome(filePath, deps.homedir)
	if (path.isAbsolute(expanded)) {
		return expanded
	}
	const kind = options.kind ?? "any"
	// The layer's own folder is the only place its relative path can mean: another folder may hold a different file with
	// the same name. Without a recorded folder, every workspace folder is a candidate.
	const folders = options.workspaceFolder ? [options.workspaceFolder] : deps.workspaceFolders
	const candidates = [
		...(kind === "cache" ? [] : folders.map((folder) => path.join(folder, expanded))),
		...(kind === "project" ? [] : deps.cacheDirs.map((dir) => path.join(dir, expanded))),
	]
	for (const candidate of candidates) {
		if (await deps.exists(candidate)) {
			return candidate
		}
	}
	return expanded
}
