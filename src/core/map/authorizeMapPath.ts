import * as fs from "fs/promises"
import * as path from "path"
import { isPathInside } from "../workspace/workspaceGeoPaths"

/**
 * The one question every map path is asked before the host reads it, opens it, or lets the webview load it:
 * "is this file one the user has put in reach of the map?"
 *
 * A path is authorised when, with symlinks resolved, it is
 *   - inside an open workspace folder,
 *   - inside one of AI-Hydro's own directories (the layer cache and the tools' output), or
 *   - a file the user picked: the Add file dialog, the Explorer menu, Load to Map, or a layer that was already on the
 *     map in an earlier session (`grantMapPath`, called from those host routes and never from the webview).
 * Anything else is refused with a reason. Callers pass the path after resolving it and use the returned `path` (the
 * resolved one) for the read, so the check and the read name the same file.
 *
 * Why: the webview and map scene files are not trusted to name files. A scene or a message that supplies
 * `/etc/hosts` or `~/.ssh/id_rsa` as a layer's source must not become a file the panel can open, read or add to its
 * local resource roots.
 */

export type MapPathPurpose = "read" | "open" | "load"

export interface MapPathDeps {
	workspaceFolders: () => string[]
	aihydroDirs: () => string[]
	/**
	 * Source files of layers already on the map. Only for reading or opening what is already there (Reload source,
	 * Open file): a layer's recorded path does not make a new file loadable, so `load` ignores it.
	 */
	onMapPaths?: () => string[]
	/** `fs.realpath` semantics; replaceable in tests. */
	realpath?: (p: string) => Promise<string>
}

export type MapPathDecision =
	| { ok: true; path: string; via: "workspace" | "aihydro" | "granted" | "on-map" }
	| { ok: false; reason: string }

const granted = new Set<string>()

/** Remember a file the user chose. Only host routes that follow a user action call this. */
export function grantMapPath(absolutePath: string): void {
	if (path.isAbsolute(absolutePath)) granted.add(path.resolve(absolutePath))
}

/** For tests. */
export function clearMapPathGrants(): void {
	granted.clear()
}

/** Symlinks resolved in the part of the path that exists; the rest is kept as written. */
async function resolveLoose(p: string, realpath: (p: string) => Promise<string>): Promise<string> {
	const abs = path.resolve(p)
	try {
		return await realpath(abs)
	} catch {
		const parent = path.dirname(abs)
		return parent === abs ? abs : path.join(await resolveLoose(parent, realpath), path.basename(abs))
	}
}

export async function authorizeMapPath(
	candidate: string,
	purpose: MapPathPurpose,
	deps: MapPathDeps,
): Promise<MapPathDecision> {
	if (typeof candidate !== "string" || candidate === "" || candidate.includes("\0")) {
		return { ok: false, reason: "No file path." }
	}
	if (!path.isAbsolute(candidate)) {
		return { ok: false, reason: `The path is not absolute, so it was not ${purpose === "open" ? "opened" : "read"}.` }
	}
	const realpath = deps.realpath ?? fs.realpath
	const real = await resolveLoose(candidate, realpath)

	for (const folder of deps.workspaceFolders()) {
		if (isPathInside(await resolveLoose(folder, realpath), real)) return { ok: true, path: real, via: "workspace" }
	}
	for (const dir of deps.aihydroDirs()) {
		if (isPathInside(await resolveLoose(dir, realpath), real)) return { ok: true, path: real, via: "aihydro" }
	}
	for (const grant of granted) {
		if (grant === path.resolve(candidate) || (await resolveLoose(grant, realpath)) === real) {
			return { ok: true, path: real, via: "granted" }
		}
	}
	if (purpose !== "load") {
		for (const onMap of deps.onMapPaths?.() ?? []) {
			if (path.isAbsolute(onMap) && (await resolveLoose(onMap, realpath)) === real) return { ok: true, path: real, via: "on-map" }
		}
	}
	return {
		ok: false,
		reason: "That file is outside the project folders. Add it with Add file, or open it from the Explorer, to put it in reach of the map.",
	}
}
