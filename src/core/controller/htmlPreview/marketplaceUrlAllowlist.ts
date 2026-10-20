import { AiHydroEnv } from "@/config"

/**
 * Restricts which origins installModule/installCourse are allowed to fetch
 * from (audit finding E-2). Contributions to the Modules/Courses marketplace
 * go through a PR review against github.com/AI-Hydro/Modules and are served
 * from that repo's GitHub Pages deployment — there is no path today where a
 * legitimate `downloadUrl`/`manifestUrl` should point anywhere else. The
 * allowlist is derived from the *currently configured* base URLs (not a
 * hardcoded host) so `AI_HYDRO_MODULES_BASE_URL_LOCAL`-style dev overrides
 * keep working.
 *
 * This is not artifact signing or content-hash verification — the remote
 * `modules.json`/`courses.json` index doesn't carry an integrity hash today,
 * and adding one requires a coordinated change to the index-generating repo
 * this extension doesn't own (tracked in audits/STATUS.md E-2 as a followup).
 *
 * The live index (ai-hydro.github.io/Modules/api/*.json) lists every
 * `downloadUrl`/`manifestUrl` under https://raw.githubusercontent.com/, so that
 * host is admitted too, but only under the AI-Hydro org path prefix
 * (origin + path prefix, never the bare host). https is required throughout.
 *
 * A host allowlist is the containment we can ship unilaterally: it stops a
 * compromised or malicious index entry from pointing the extension at
 * attacker-controlled infrastructure, even without hash pinning.
 */
function trustedOrigins(): Set<string> {
	const cfg = AiHydroEnv.config()
	const origins = new Set<string>()
	for (const url of [cfg.modulesBaseUrl, cfg.researchGalleryBaseUrl, cfg.connectorsBaseUrl, cfg.skillsBaseUrl]) {
		try {
			origins.add(new URL(url).origin)
		} catch {
			// malformed config value — simply doesn't contribute an allowed origin
		}
	}
	return origins
}

/** Origin + path-prefix pairs for hosts that serve many orgs (raw GitHub content). */
const TRUSTED_PATH_PREFIXES: ReadonlyArray<{ origin: string; pathPrefix: string }> = [
	{ origin: "https://raw.githubusercontent.com", pathPrefix: "/AI-Hydro/" },
]

export function assertTrustedMarketplaceUrl(url: string, context: string): void {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		throw new Error(`${context}: not a valid URL: ${url}`)
	}
	if (parsed.protocol !== "https:") {
		throw new Error(`${context}: unsupported protocol (https required): ${parsed.protocol}`)
	}
	if (parsed.username || parsed.password) {
		throw new Error(`${context}: URL must not embed credentials`)
	}
	if (trustedOrigins().has(parsed.origin)) {
		return
	}
	// URL parsing already collapses "/AI-Hydro/../evil/"; also refuse encoded dot-segments
	// and separators that a downstream fetch could re-interpret.
	const path = parsed.pathname
	const hasEncodedTraversal = /%2e|%2f|%5c/i.test(path)
	if (
		!hasEncodedTraversal &&
		TRUSTED_PATH_PREFIXES.some((e) => e.origin === parsed.origin && path.startsWith(e.pathPrefix))
	) {
		return
	}
	throw new Error(`${context}: origin not in the marketplace allowlist: ${parsed.origin}`)
}
