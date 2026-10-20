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
 * host is admitted too, but only under the repo + branch prefix in
 * TRUSTED_RAW_MARKETPLACE_PREFIXES (never the bare host or the whole org).
 * https is required throughout.
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

/**
 * raw.githubusercontent.com is shared by every GitHub account, and GitHub serves
 * commits from forks (including unmerged PRs) under the upstream repo path by
 * SHA, so an org-level rule would accept unreviewed content. Raw URLs are
 * accepted only under an explicit repo + named-branch prefix, derived from the
 * URLs the live index (Modules/api/{modules,courses}.json) actually uses.
 * Same policy shape as skills/skillUrlPolicy.ts. Applies to module and course
 * installs only (assertTrustedModuleContentUrl), never to skills.
 */
export const TRUSTED_RAW_MARKETPLACE_PREFIXES: readonly string[] = ["https://raw.githubusercontent.com/AI-Hydro/Modules/main/"]

function isTrustedRawMarketplaceUrl(parsed: URL, rawUrl: string): boolean {
	if (parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) {
		return false
	}
	// No percent-encoding: it could hide separators or dot segments.
	if (parsed.pathname.includes("%") || rawUrl.includes("%")) {
		return false
	}
	// `new URL` has already collapsed dot segments; anything left is hostile.
	if (parsed.pathname.split("/").some((seg) => seg === ".." || seg === ".")) {
		return false
	}
	const normalized = `${parsed.origin}${parsed.pathname}`
	return TRUSTED_RAW_MARKETPLACE_PREFIXES.some((prefix) => normalized.startsWith(prefix) && normalized.length > prefix.length)
}

/** Body caps for marketplace downloads (a module is a single self-contained HTML file). */
export const MAX_MODULE_BYTES = 8 * 1024 * 1024
export const MAX_MANIFEST_BYTES = 1024 * 1024

/**
 * Base policy: configured marketplace origins only. Shared with skills, which
 * keep their own repo-by-repo raw table (skills/skillUrlPolicy.ts) and must NOT
 * inherit the Modules raw prefix.
 */
export function assertTrustedMarketplaceUrl(url: string, context: string): void {
	assertUrl(url, context, false)
}

/** Module and course content: base policy plus the Modules raw prefix (live-index shape). */
export function assertTrustedModuleContentUrl(url: string, context: string): void {
	assertUrl(url, context, true)
}

function assertUrl(url: string, context: string, allowModulesRaw: boolean): void {
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
		throw new Error(`${context}: URL not in the marketplace allowlist: embedded credentials are not permitted`)
	}
	if (trustedOrigins().has(parsed.origin)) {
		return
	}
	if (allowModulesRaw && isTrustedRawMarketplaceUrl(parsed, url)) {
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
	assertTrustedModuleContentUrl(href, `${context} redirect`)
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
