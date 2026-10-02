import { createHash } from "crypto"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

/**
 * Marketplace skill ids become directory names under ~/.aihydro/skills/marketplace,
 * so they must be plain slugs. Mirrors the id grammar the Skills catalog uses
 * (lowercase, digits, `-`, `_`; first char alphanumeric; max 64).
 */
export const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/

export function skillsRoot(homeDir: string = os.homedir()): string {
	return path.join(homeDir, ".aihydro", "skills")
}

/**
 * Resolve `<skills root>/<sourceDir>/<skillId>` and prove it stays strictly
 * inside `<skills root>/<sourceDir>`. Throws on an empty id or any id that
 * escapes the source directory (e.g. `..`, `../x`, absolute paths).
 */
export function resolveSkillDir(sourceDir: string, skillId: string, homeDir: string = os.homedir()): string {
	const base = path.resolve(skillsRoot(homeDir), sourceDir)
	const resolved = path.resolve(base, skillId)
	if (!skillId || !resolved.startsWith(base + path.sep)) {
		throw new Error(`Invalid skillId: resolves outside the ${sourceDir} skills directory`)
	}
	return resolved
}

/** Strict validation for ids that come from the (untrusted) marketplace catalog. */
export function assertValidMarketplaceSkillId(skillId: string): void {
	if (typeof skillId !== "string" || !SKILL_ID_PATTERN.test(skillId)) {
		throw new Error(`Invalid skillId: must match ${SKILL_ID_PATTERN.source}`)
	}
}

/** Maximum SKILL.md size accepted from the network (it is injected into prompts). */
export const MAX_SKILL_BYTES = 1024 * 1024

/** `sha256:<64 hex>` of the exact bytes. */
export function sha256Digest(data: string | Uint8Array): string {
	return `sha256:${createHash("sha256").update(data).digest("hex")}`
}

/** Map an `installed.json` `source` value to its directory under the skills root. */
export function sourceDirForRegistrySource(source: unknown): string | undefined {
	switch (source) {
		case "marketplace":
			return "marketplace"
		case "manual":
			return "manual"
		case "agent_created":
			return "agent-created"
		default:
			return undefined
	}
}

/**
 * True when `localPath`, after resolving symlinks, lies strictly inside
 * `<skills root>/<sourceDir>`. Used at injection time so a tampered
 * `installed.json` cannot point the prompt builder at arbitrary files.
 */
export async function isInsideSkillsSource(sourceDir: string, localPath: string, homeDir?: string): Promise<boolean> {
	try {
		const base = await fs.realpath(path.resolve(skillsRoot(homeDir), sourceDir))
		const target = await fs.realpath(path.resolve(localPath))
		return target.startsWith(base + path.sep)
	} catch {
		return false
	}
}
