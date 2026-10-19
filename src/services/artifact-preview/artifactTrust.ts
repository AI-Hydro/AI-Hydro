import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { type ArtifactTrustSource, isTrustedArtifactSource } from "@shared/artifactTrust"
import { isIsolatedLocalE2E } from "@/services/test/isIsolatedLocalE2E"

/**
 * Host-side execution-trust enforcement for Studio documents. See
 * `src/shared/artifactTrust.ts` for the model. This file owns the state
 * (per-document allowances) and the source classification.
 */

interface TrustSubject {
	id: string
	contentHash: string
	trustSource: ArtifactTrustSource
	/**
	 * The shell renders this exact hashed snapshot (`srcdoc`) rather than loading the
	 * live file from disk. A document served from a live URL can change after it was
	 * allowed, so it can never hold an allowance.
	 */
	servedFromSnapshot: boolean
}

function eligible(subject: TrustSubject): boolean {
	if (!isTrustedArtifactSource(subject.trustSource) || !subject.servedFromSnapshot) {
		return false
	}
	// The e2e source exists only for the isolated Playwright host.
	return subject.trustSource !== "e2e-fixture" || isIsolatedLocalE2E()
}

/**
 * Per-document allowances, in memory for the lifetime of the extension host.
 * An allowance is bound to the document's content hash: if the file changes the
 * allowance silently lapses, and a restart clears everything.
 */
export class ArtifactTrustStore {
	private readonly allowances = new Map<string, string>()

	/** Allow execution. Refuses (returns false) for any ineligible document. */
	allow(subject: TrustSubject): boolean {
		if (!eligible(subject)) {
			return false
		}
		this.allowances.set(subject.id, subject.contentHash)
		return true
	}

	revoke(id: string): void {
		this.allowances.delete(id)
	}

	isAllowed(subject: TrustSubject | undefined): boolean {
		return Boolean(subject && eligible(subject) && this.allowances.get(subject.id) === subject.contentHash)
	}
}

export type ExecutionDenial = "untrusted" | "not-allowed"

export function executionDenialMessage(source: ArtifactTrustSource, reason: ExecutionDenial): string {
	if (reason === "not-allowed") {
		return 'denied: execution has not been allowed for this document. Use "Allow execution" in the Studio trust bar.'
	}
	return source === "unsigned-module"
		? "denied: document is an unsigned marketplace module, not a trusted executable module"
		: "denied: document is not an executable module"
}

// ─── Source classification ──────────────────────────────────────────────

async function realpathOr(candidate: string): Promise<string> {
	try {
		return await fs.realpath(candidate)
	} catch {
		return path.resolve(candidate)
	}
}

export function containedBy(candidate: string, parent: string): boolean {
	const relative = path.relative(parent, candidate)
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

/** Marketplace install roots (modules and courses). Their content is unsigned. */
export function marketplaceInstallRoots(home = os.homedir()): string[] {
	return [path.join(home, ".aihydro", "modules"), path.join(home, ".aihydro", "courses")]
}

/** Symlink-safe: both sides are resolved with realpath before comparing. */
export async function isUnsignedMarketplacePath(fsPath: string, home = os.homedir()): Promise<boolean> {
	const resolved = await realpathOr(fsPath)
	for (const root of marketplaceInstallRoots(home)) {
		if (containedBy(resolved, await realpathOr(root))) {
			return true
		}
	}
	return false
}

/**
 * Test-only trust seam for the isolated Playwright extension host: paths listed in
 * `AIHYDRO_E2E_TRUSTED_FIXTURES` (path-delimiter separated files or directories)
 * are "e2e-fixture". Inert unless E2E_TEST=true and AIHYDRO_ENVIRONMENT=local.
 */
async function isE2ETrustedFixture(fsPath: string, env: NodeJS.ProcessEnv): Promise<boolean> {
	if (!isIsolatedLocalE2E(env)) {
		return false
	}
	const raw = env.AIHYDRO_E2E_TRUSTED_FIXTURES
	if (!raw) {
		return false
	}
	const resolved = await realpathOr(fsPath)
	for (const entry of raw.split(path.delimiter).filter(Boolean)) {
		if (containedBy(resolved, await realpathOr(entry))) {
			return true
		}
	}
	return false
}

/**
 * Classify a file about to be registered. `installedPack` is the result of the
 * Learning Pack registry lookup, which also re-verifies the installed bytes
 * against the pack's signed checksums (see resolveInstalledLearningPackArtifact).
 */
export async function classifyArtifactFile(
	fsPath: string,
	opts: { installedPack: boolean; home?: string; env?: NodeJS.ProcessEnv },
): Promise<ArtifactTrustSource> {
	if (opts.installedPack) {
		return "learning-pack"
	}
	if (await isUnsignedMarketplacePath(fsPath, opts.home)) {
		return "unsigned-module"
	}
	if (await isE2ETrustedFixture(fsPath, opts.env ?? process.env)) {
		return "e2e-fixture"
	}
	return "document"
}
