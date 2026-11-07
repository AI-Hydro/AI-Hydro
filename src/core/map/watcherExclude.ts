/**
 * `files.watcherExclude` against one file. VS Code merges the setting's patterns (defaults, user, workspace) into one
 * object of `glob: enabled`; a file one of the enabled globs matches is not reported by the workspace watcher. Globs are
 * matched against the path below the workspace folder and against the absolute path.
 */

/** `minimatch` is a build-only package the extension bundle guard forbids, so the few glob forms the setting uses are matched here. */
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
		else if (c === "[" && glob.indexOf("]", i + 2) > 0) {
			const end = glob.indexOf("]", i + 2)
			let body = glob.slice(i + 1, end)
			const negated = body[0] === "!" || body[0] === "^"
			if (negated) body = body.slice(1)
			out += `[${negated ? "^" : ""}${body.replace(/[\\\]^]/g, "\\$&")}]`
			i = end
		} else if (c === "{") {
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
		// A drive letter is the same drive in either case.
		const drive = /^[A-Za-z]:/.test(base)
		const inside = drive ? abs.toLowerCase().startsWith(`${base.toLowerCase()}/`) : abs.startsWith(`${base}/`)
		if (inside) candidates.push(abs.slice(base.length + 1))
	}
	for (const [glob, enabled] of Object.entries(patterns)) {
		if (enabled !== true) continue
		const g = slashed(glob)
		const re = globToRegExp(g)
		if (candidates.some((c) => re.test(c))) return true
	}
	return false
}
