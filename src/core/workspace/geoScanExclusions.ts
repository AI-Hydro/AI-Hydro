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
	// The tools' own state and run output: layers made by a run reach the map as Results, and the folder is not the
	// user's data. Listing it here would show every run's files twice.
	".aihydro",
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

/**
 * Turns the user's `files.exclude` setting (`{ "**\/.git": true, "**\/*.pyc": true }`) into extra exclude globs for
 * `findFiles`. `findFiles` ignores the setting when it is given an exclude of its own, so the two are merged here.
 * A pattern with braces or commas cannot be placed inside the `{a,b}` list and is returned in `unsupported`, not
 * dropped silently. A pattern that names a directory also excludes what is inside it.
 */
export function mergeFilesExclude(setting: Record<string, unknown> | undefined): {
	globs: string[]
	/** Directory names a pattern points at (`**\/.git` gives `.git`), for the "N folders skipped" line. */
	dirNames: string[]
	unsupported: string[]
} {
	const globs: string[] = []
	const dirNames: string[] = []
	const unsupported: string[] = []
	for (const [pattern, enabled] of Object.entries(setting ?? {})) {
		if (enabled !== true) continue
		if (/[{},]/.test(pattern)) {
			unsupported.push(pattern)
			continue
		}
		globs.push(pattern)
		if (!pattern.endsWith("/**")) globs.push(`${pattern}/**`)
		const bare = pattern.replace(/^(\*\*\/)+/, "").replace(/\/\*\*$/, "")
		if (bare !== "" && !/[*?[\]/]/.test(bare)) dirNames.push(bare)
	}
	return { globs, dirNames, unsupported }
}

/** The exclude glob for `findFiles`: the fixed list plus the user's `files.exclude` globs. */
export function buildExcludeGlob(extraGlobs: readonly string[] = []): string {
	const all = [...WORKSPACE_GEO_EXCLUDED_DIRS.map((dir) => `**/${dir}/**`), ...extraGlobs]
	return `{${all.join(",")}}`
}

/** True when a directory segment of `relativePath` is one of the extra directory names (from `files.exclude`). */
export function isExcludedByNames(relativePath: string, dirNames: readonly string[]): boolean {
	if (dirNames.length === 0) return false
	const segments = relativePath.split(/[\\/]+/).filter(Boolean)
	return segments.slice(0, -1).some((segment) => dirNames.includes(segment))
}
