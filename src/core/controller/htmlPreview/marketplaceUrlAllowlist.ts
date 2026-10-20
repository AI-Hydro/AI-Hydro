import * as path from "node:path"
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

/** Body caps for marketplace downloads (a module is a single self-contained HTML file). */
export const MAX_MODULE_BYTES = 8 * 1024 * 1024
export const MAX_MANIFEST_BYTES = 1024 * 1024

export function assertTrustedMarketplaceUrl(url: string, context: string): void {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		throw new Error(`${context}: not a valid URL: ${url}`)
	}
	// https only: marketplace content is installed on disk and previewed, so a
	// plaintext hop would let a network attacker substitute the document.
	if (parsed.protocol !== "https:") {
		throw new Error(`${context}: unsupported protocol ${parsed.protocol} (https is required)`)
	}
	if (parsed.username || parsed.password) {
		throw new Error(`${context}: URL must not embed credentials`)
	}
	if (trustedOrigins().has(parsed.origin)) {
		return
	}
	// URL parsing already collapses "/AI-Hydro/../evil/"; also refuse encoded dot-segments
	// and separators that a downstream fetch could re-interpret.
	const pathname = parsed.pathname
	const hasEncodedTraversal = /%2e|%2f|%5c/i.test(pathname)
	if (
		!hasEncodedTraversal &&
		TRUSTED_PATH_PREFIXES.some((e) => e.origin === parsed.origin && pathname.startsWith(e.pathPrefix))
	) {
		return
	}
	throw new Error(`${context}: origin not in the marketplace allowlist: ${parsed.origin}`)
}

/**
 * axios `beforeRedirect` hook: a redirect may not leave the marketplace
 * allowlist or downgrade to http. Throwing aborts the request.
 */
export function assertTrustedMarketplaceRedirect(options: Record<string, unknown>, context: string): void {
	const href =
		typeof options.href === "string"
			? options.href
			: `${options.protocol ?? ""}//${options.hostname ?? options.host ?? ""}${options.path ?? ""}`
	assertTrustedMarketplaceUrl(href, `${context} redirect`)
}

/**
 * Module and course ids become directory names under ~/.aihydro. Accept only a
 * single plain path segment so `..`, separators, drive letters and absolute
 * paths can never escape the install root.
 */
const SAFE_MARKETPLACE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export function sanitizeMarketplaceId(id: unknown, context: string): string {
	if (typeof id !== "string" || !SAFE_MARKETPLACE_ID.test(id) || id.includes("..")) {
		throw new Error(`${context}: invalid id (letters, digits, '.', '_' and '-' only; no path separators or '..')`)
	}
	return id
}

/** Join `id` under `root`, re-checking containment after resolution. */
export function resolveContainedInstallDir(root: string, id: string, context: string): string {
	const safeId = sanitizeMarketplaceId(id, context)
	const resolvedRoot = path.resolve(root)
	const dir = path.resolve(resolvedRoot, safeId)
	const relative = path.relative(resolvedRoot, dir)
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error(`${context}: id escapes the install directory`)
	}
	return dir
}
