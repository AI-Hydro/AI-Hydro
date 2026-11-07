/**
 * `files.watcherExclude` against one file. VS Code merges the setting's patterns (defaults, user, workspace) into one
 * object of `glob: enabled`; a file one of the enabled globs matches is not reported by the workspace watcher. The globs
 * VS Code documents for this setting are `**`, `*`, `?` and `{a,b}`, matched against the path below the workspace folder
 * (a leading `**` also matches the absolute path).
 */

const cache = new Map<string, RegExp>()

function globToRegExp(glob: string): RegExp {
	const hit = cache.get(glob)
	if (hit) return hit
	let out = ""
	let braces = 0
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i]
		if (c === "*") {
			if (glob[i + 1] === "*") {
				i++
				if (glob[i + 1] === "/") {
					i++
					out += "(?:.*/)?"
				} else out += ".*"
			} else out += "[^/]*"
		} else if (c === "?") out += "[^/]"
		else if (c === "{") {
			braces++
			out += "(?:"
		} else if (c === "}" && braces > 0) {
			braces--
			out += ")"
		} else if (c === "," && braces > 0) out += "|"
		else out += c.replace(/[.+^$()|[\]\\]/g, "\\$&")
	}
	const re = new RegExp(`^${out}$`)
	cache.set(glob, re)
	return re
}

const slashed = (p: string) => p.replace(/\\/g, "/")

/** True when an enabled pattern matches `file` as seen from the workspace folder that holds it. */
export function isWatcherExcluded(patterns: Record<string, boolean> | undefined, folders: string[], file: string): boolean {
	if (!patterns) return false
	const abs = slashed(file)
	const candidates = [abs]
	for (const folder of folders) {
		const base = slashed(folder).replace(/\/+$/, "")
		if (abs.startsWith(`${base}/`)) candidates.push(abs.slice(base.length + 1))
	}
	for (const [glob, enabled] of Object.entries(patterns)) {
		if (enabled !== true) continue
		const re = globToRegExp(slashed(glob))
		if (candidates.some((c) => re.test(c))) return true
	}
	return false
}
