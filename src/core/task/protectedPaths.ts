/**
 * Protected paths (approval redesign AP1, finding B3). Agent file writes to these always ask, even with
 * "Edit" auto-run on, "Edit all files" on, or YOLO. Commands that mention them always ask too
 * (commandPolicy.ts: commandMentionsProtectedPath).
 *
 *  - the extension's global storage directory (settings, state, the MCP settings file with every server's
 *    `autoApprove`/trust, the first-party launcher record);
 *  - $AIHYDRO_HOME/{approvals,trust,registry} (approval records, the signing trust root, the claim registry);
 *  - $AIHYDRO_HOME/{learning-packs,modules,courses} (installed Learning Packs and their registry, marketplace
 *    installs): Studio trusts a pack module because it is in the pack store, so the agent must not write there
 *    without approval. $AIHYDRO_LEARNING_PACK_ROOT, when set, is protected too. A process running as the same
 *    user (a terminal, another program) can still write these directories; see docs/studio-trust-model.md;
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
	/** $AIHYDRO_LEARNING_PACK_ROOT as seen by the extension, if it relocates the pack store. */
	learningPackRoot?: string
}

export function computeProtectedRoots(inputs: ProtectedRootInputs = {}): string[] {
	const home = inputs.homeDir ?? os.homedir()
	const aihydroHomes = new Set<string>([path.join(home, ".aihydro")])
	if (inputs.aihydroHome) {
		aihydroHomes.add(path.resolve(inputs.aihydroHome))
	}
	const roots: string[] = [path.join(home, ".ssh")]
	for (const base of aihydroHomes) {
		for (const sub of ["approvals", "trust", "registry", "learning-packs", "modules", "courses"]) {
			roots.push(path.join(base, sub))
		}
	}
	if (inputs.learningPackRoot) {
		roots.push(path.resolve(inputs.learningPackRoot))
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

/** A repository's config and hooks can make git run programs (core.pager, core.fsmonitor, hooks), so they are protected too. */
const GIT_EXEC_PATH = /(^|\/)\.git\/(config|hooks)(\/|$)/i

/** Whether an absolute path equals or lies inside any protected root (also checks the symlink-resolved path). */
export function isProtectedPath(absolutePath: string, roots: readonly string[]): boolean {
	if (GIT_EXEC_PATH.test(absolutePath.replace(/\\/g, "/"))) {
		return true
	}
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
