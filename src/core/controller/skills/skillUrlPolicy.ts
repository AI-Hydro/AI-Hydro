import { assertTrustedMarketplaceUrl } from "../htmlPreview/marketplaceUrlAllowlist"

/**
 * Skill origin policy. The shared marketplace allowlist (modules/courses/
 * gallery/connectors/skills base URLs, i.e. the GitHub Pages origins) is
 * checked first. The live Skills catalog, however, points `skill_url` at
 * `raw.githubusercontent.com/AI-Hydro/<repo>/...` (Skills and swatplus-builder),
 * an origin shared by every GitHub account, so it cannot be allowlisted by
 * origin alone. It is accepted only over https and only under the AI-Hydro
 * organisation path.
 */
const RAW_GITHUB_ORIGIN = "https://raw.githubusercontent.com"
const TRUSTED_RAW_OWNER = "ai-hydro"

export function assertTrustedSkillUrl(url: string, context: string): void {
	try {
		assertTrustedMarketplaceUrl(url, context)
		return
	} catch (allowlistError) {
		let parsed: URL
		try {
			parsed = new URL(url)
		} catch {
			throw allowlistError
		}
		const owner = parsed.pathname.split("/")[1]?.toLowerCase()
		if (parsed.origin === RAW_GITHUB_ORIGIN && !parsed.username && !parsed.password && owner === TRUSTED_RAW_OWNER) {
			return
		}
		throw allowlistError
	}
}
