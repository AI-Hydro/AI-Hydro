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
