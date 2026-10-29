import * as fs from "node:fs"
import * as path from "node:path"

/**
 * Locate the rendered-site root for an artifact that lives inside a Quarto
 * (or Quarto-like) multi-file output tree.
 *
 * A page such as `_build/aihydro/labs/03-unit-hydrograph-convolution.html`
 * references sibling-of-parent assets (`../site_libs/bootstrap/…`). For those
 * URLs to be servable by the webview, the *site root* (`_build/aihydro/`)
 * must be present in `localResourceRoots`, not just the page's own directory.
 *
 * Security bound: rooting an ancestor directory widens what any preview
 * iframe can fetch, so the walk is deliberately conservative:
 *   • at most MAX_WALK_UP levels above the artifact's directory;
 *   • a directory qualifies only with BOTH markers of a rendered Quarto site:
 *     a `site_libs/` child directory AND a `search.json` file (every rendered
 *     profile emits both; a coincidentally named `site_libs` alone does not
 *     qualify);
 *   • the first (deepest) qualifying directory wins.
 *
 * Callers must log the added root for auditability.
 */
const MAX_WALK_UP = 3

export function findQuartoSiteRoot(dirFsPath: string): string | null {
	let current = path.resolve(dirFsPath)
	for (let level = 0; level <= MAX_WALK_UP; level++) {
		if (isQuartoSiteRoot(current)) {
			return current
		}
		const parent = path.dirname(current)
		if (parent === current) {
			return null
		}
		current = parent
	}
	return null
}

function isQuartoSiteRoot(dir: string): boolean {
	try {
		return fs.statSync(path.join(dir, "site_libs")).isDirectory() && fs.statSync(path.join(dir, "search.json")).isFile()
	} catch {
		return false
	}
}
