/**
 * Protected paths (approval redesign AP1, finding B3). Agent file writes to these always ask, even with
 * "Edit" auto-run on, "Edit all files" on, or YOLO. Commands that mention them always ask too
 * (commandPolicy.ts: commandMentionsProtectedPath).
 *
 *  - the extension's global storage directory (settings, state, the MCP settings file with every server's
 *    `autoApprove`/trust, the first-party launcher record);
 *  - $AIHYDRO_HOME/{approvals,trust,registry} (approval records, the signing trust root, the claim registry);
 *  - ~/.ssh (signing keys and agent sockets).
 *
 * Pure: everything environmental is passed in, so tests need no VS Code host.
 */
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

export interface ProtectedRootInputs {
	/** The extension's global storage directory (HostProvider.get().globalStorageFsPath). */
	globalStoragePath?: string
	/** Home directory; defaults to os.homedir(). */
	homeDir?: string
	/** $AIHYDRO_HOME as seen by the extension; the default ~/.aihydro is always included as well. */
	aihydroHome?: string
}

export function computeProtectedRoots(inputs: ProtectedRootInputs = {}): string[] {
	const home = inputs.homeDir ?? os.homedir()
	const aihydroHomes = new Set<string>([path.join(home, ".aihydro")])
	if (inputs.aihydroHome) {
		aihydroHomes.add(path.resolve(inputs.aihydroHome))
	}
	const roots: string[] = [path.join(home, ".ssh")]
	for (const base of aihydroHomes) {
		for (const sub of ["approvals", "trust", "registry"]) {
			roots.push(path.join(base, sub))
		}
	}
	if (inputs.globalStoragePath) {
		roots.push(path.resolve(inputs.globalStoragePath))
	}
	return roots
}

const caseInsensitiveFs = process.platform === "win32" || process.platform === "darwin"

function comparable(p: string): string {
	const resolved = path.resolve(p)
	return caseInsensitiveFs ? resolved.toLowerCase() : resolved
}

/**
 * realpath of the deepest existing ancestor with the missing tail re-appended, so a symlink inside the
 * workspace that points into a protected directory is still seen as protected, and so is a file not yet created.
 */
function resolveThroughSymlinks(target: string): string {
	let existing = path.resolve(target)
	const tail: string[] = []
	for (;;) {
		try {
			const real = fs.realpathSync(existing)
			return path.join(real, ...tail.reverse())
		} catch {
			const parent = path.dirname(existing)
			if (parent === existing) {
				return path.resolve(target)
			}
			tail.push(path.basename(existing))
			existing = parent
		}
	}
}

/** Whether an absolute path equals or lies inside any protected root (also checks the symlink-resolved path). */
export function isProtectedPath(absolutePath: string, roots: readonly string[]): boolean {
	const candidates = new Set([comparable(absolutePath), comparable(resolveThroughSymlinks(absolutePath))])
	const rootForms = roots.flatMap((root) => [comparable(root), comparable(resolveThroughSymlinks(root))])
	for (const candidate of candidates) {
		for (const root of rootForms) {
			if (candidate === root || candidate.startsWith(root + path.sep)) {
				return true
			}
		}
	}
	return false
}
