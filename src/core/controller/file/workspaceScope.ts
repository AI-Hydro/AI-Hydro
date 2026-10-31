import { getWorkspacePath } from "@utils/path"
import * as fs from "fs"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"

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

/**
 * Where aihydro-tools (2.8.5) writes files that are not under the workspace, when a study has no workspace directory
 * (read from `ai_hydro/mcp/tools_analysis.py`, `tools_indices.py`, `tools_session.py`, `tools_modelling.py`,
 * `tools_inundation_physics.py`, `tools_data_async.py`): `$AIHYDRO_HOME/sessions/<id>/outputs`, `exports`, `models`,
 * `surrogate`, `inundation_physics`, `inundation_surrogate`, `data_jobs`. Deliberately not the whole home: `trust/`,
 * `approvals/`, `registry/` and the like stay out of reach of a chip.
 */
const TOOL_OUTPUT_DIRS = ["exports", "models", "surrogate", "inundation_physics", "inundation_surrogate", "data_jobs"]

export function isToolOutputPath(home: string, absolutePath: string): boolean {
	if (TOOL_OUTPUT_DIRS.some((d) => isInsideRoot(path.join(home, d), absolutePath))) {
		return true
	}
	const sessions = path.join(home, "sessions")
	const rel = path.relative(sessions, absolutePath)
	if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
		return false
	}
	const [id, sub] = rel.split(path.sep)
	return !!id && sub === "outputs" && isInsideRoot(path.join(sessions, id, "outputs"), absolutePath)
}

/** A chip may point at a file in any workspace root or in a tool-output location; nothing else. */
export function isChipPathAllowed(workspaceRoots: readonly string[], home: string, absolutePath: string): boolean {
	return workspaceRoots.some((r) => isInsideRoot(r, absolutePath)) || isToolOutputPath(home, absolutePath)
}

/**
 * Resolve a chip's path against every workspace root (the first root that holds an allowed existing file wins), so a
 * multi-root window is not limited to the first folder. `mustBeFile` false skips the existence test (open click).
 */
export function resolveChipPath(
	workspaceRoots: readonly string[],
	home: string,
	value: string,
	mustBeFile: boolean,
): string | undefined {
	const candidates = path.isAbsolute(value) ? [value] : workspaceRoots.map((r) => path.resolve(r, value))
	for (const abs of candidates) {
		if (!isChipPathAllowed(workspaceRoots, home, abs)) {
			continue
		}
		if (!mustBeFile) {
			return abs
		}
		try {
			if (fs.statSync(abs).isFile()) {
				return abs
			}
		} catch {
			/* try the next root */
		}
	}
	return undefined
}

/** The active workspace folder first, then every other root of a multi-root window. */
export async function chipRoots(): Promise<string[]> {
	const roots: string[] = []
	const primary = await getWorkspacePath()
	if (primary) {
		roots.push(primary)
	}
	try {
		for (const p of (await HostProvider.workspace.getWorkspacePaths({})).paths) {
			if (p && !roots.includes(p)) {
				roots.push(p)
			}
		}
	} catch {
		/* no host (tests): the primary root alone */
	}
	return roots
}
