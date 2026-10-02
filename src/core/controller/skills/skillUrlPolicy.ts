import { assertTrustedMarketplaceUrl } from "../htmlPreview/marketplaceUrlAllowlist"

/**
 * Skill origin policy. The shared marketplace allowlist (modules/courses/
 * gallery/connectors/skills base URLs, i.e. the GitHub Pages origins) is
 * checked first. The live Skills catalog, however, points `skill_url` at
 * `raw.githubusercontent.com`, an origin shared by every GitHub account, and
 * GitHub serves commits from forks (including unmerged PRs) under the upstream
 * repository path by SHA. An owner-level rule would therefore accept
 * unreviewed content. Raw URLs are accepted only under an explicit
 * repo + named-branch prefix table, derived from the URLs the live catalog
 * (`Skills/api/skills.json`) actually uses. Any other repo, any other ref
 * (including 40-hex SHAs), percent-encoding, dot segments, a query or a
 * fragment is rejected.
 */
export const TRUSTED_RAW_SKILL_PREFIXES: readonly string[] = [
	"https://raw.githubusercontent.com/AI-Hydro/Skills/main/",
	"https://raw.githubusercontent.com/AI-Hydro/swatplus-builder/main/",
]

function isTrustedRawSkillUrl(url: string): boolean {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		return false
	}
	if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
		return false
	}
	if (parsed.search || parsed.hash) {
		return false
	}
	// Reject any percent-encoding rather than decode-then-compare: no legitimate
	// catalog path needs it, and it blocks encoded separators / dot segments.
	if (parsed.pathname.includes("%") || url.includes("%")) {
		return false
	}
	// `new URL` has already collapsed dot segments; anything left is hostile.
	if (parsed.pathname.split("/").some((seg) => seg === ".." || seg === ".")) {
		return false
	}
	const normalized = `${parsed.origin}${parsed.pathname}`
	return TRUSTED_RAW_SKILL_PREFIXES.some((prefix) => normalized.startsWith(prefix) && normalized.length > prefix.length)
}

export function assertTrustedSkillUrl(url: string, context: string): void {
	try {
		assertTrustedMarketplaceUrl(url, context)
		return
	} catch (allowlistError) {
		if (isTrustedRawSkillUrl(url)) {
			return
		}
		throw allowlistError
	}
}
