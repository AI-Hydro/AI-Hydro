/**
 * Directories the workspace geo scan never descends into.
 *
 * The scan lists GeoJSON/KML/... files the user can add to the map. Dependency trees, VCS metadata, build
 * output, virtualenvs, git worktrees and archived code contain thousands of unrelated `*.json` files, so
 * they are excluded both from `findFiles` and from watcher events (the watcher glob is workspace-wide).
 */
export const WORKSPACE_GEO_EXCLUDED_DIRS = [
	"node_modules",
	".git",
	".worktrees",
	"_archive",
	".venv",
	"venv",
	"dist",
	"out",
	"build",
	"__pycache__",
	"env",
	".tox",
	"site-packages",
	".ipynb_checkpoints",
	".cache",
	"target",
] as const

/** Glob for `vscode.workspace.findFiles(include, exclude)`. */
export const WORKSPACE_GEO_EXCLUDE_GLOB = `{${WORKSPACE_GEO_EXCLUDED_DIRS.map((dir) => `**/${dir}/**`).join(",")}}`

/** True when any path segment (directory) of `relativePath` is an excluded directory. */
export function isExcludedWorkspaceGeoPath(relativePath: string): boolean {
	const segments = relativePath.split(/[\\/]+/).filter(Boolean)
	// The last segment is the file name; only directories are excluded.
	return segments.slice(0, -1).some((segment) => (WORKSPACE_GEO_EXCLUDED_DIRS as readonly string[]).includes(segment))
}
