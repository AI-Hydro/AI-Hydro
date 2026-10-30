import * as fs from "fs"
import * as path from "path"

/**
 * Whether `absolutePath` is inside `root`, lexically and (when both exist) after resolving symlinks, so a link inside
 * the workspace that points at `~/.ssh` is outside. Chips in a model's answer are scoped with this: a model must not
 * be able to put a clickable `~/.ssh/...` or `/etc/...` link in front of the user.
 */
export function isInsideRoot(root: string, absolutePath: string): boolean {
	const inside = (r: string, p: string) => {
		const rel = path.relative(r, p)
		return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
	}
	if (!inside(root, absolutePath)) {
		return false
	}
	try {
		return inside(fs.realpathSync(root), fs.realpathSync(absolutePath))
	} catch {
		return true // not on disk (yet): the lexical answer stands
	}
}
