/**
 * `files.watcherExclude` against one file. VS Code merges the setting's patterns (defaults, user, workspace) into one
 * object of `glob: enabled`; a file one of the enabled globs matches is not reported by the workspace watcher. Globs are
 * matched against the path below the workspace folder and against the absolute path.
 */

import minimatch from "minimatch"

const slashed = (p: string) => p.replace(/\\/g, "/")

/** True when an enabled pattern matches `file` as seen from the workspace folder that holds it. */
export function isWatcherExcluded(patterns: Record<string, boolean> | undefined, folders: string[], file: string): boolean {
	if (!patterns) return false
	const abs = slashed(file)
	const candidates = [abs]
	for (const folder of folders) {
		const base = slashed(folder).replace(/\/+$/, "")
		// A drive letter is the same drive in either case.
		const drive = /^[A-Za-z]:/.test(base)
		const inside = drive ? abs.toLowerCase().startsWith(`${base.toLowerCase()}/`) : abs.startsWith(`${base}/`)
		if (inside) candidates.push(abs.slice(base.length + 1))
	}
	for (const [glob, enabled] of Object.entries(patterns)) {
		if (enabled !== true) continue
		const g = slashed(glob)
		if (candidates.some((c) => minimatch(c, g, { dot: true }))) return true
	}
	return false
}
