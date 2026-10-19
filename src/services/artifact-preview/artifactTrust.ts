import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { type ArtifactTrustSource, isTrustedArtifactSource } from "@shared/artifactTrust"

/**
 * Host-side execution-trust enforcement for Studio documents. See
 * `src/shared/artifactTrust.ts` for the model. This file owns the state
 * (per-document allowances) and the source classification.
 */

interface TrustSubject {
	id: string
	contentHash: string
	trustSource: ArtifactTrustSource
}

/**
 * Per-document allowances, in memory for the lifetime of the extension host.
 * An allowance is bound to the document's content hash: if the file changes the
 * allowance silently lapses, and a restart clears everything.
 */
export class ArtifactTrustStore {
	private readonly allowances = new Map<string, string>()

	/** Allow execution. Refuses (returns false) for any untrusted source. */
	allow(subject: TrustSubject): boolean {
		if (!isTrustedArtifactSource(subject.trustSource)) {
			return false
		}
		this.allowances.set(subject.id, subject.contentHash)
		return true
	}

	revoke(id: string): void {
		this.allowances.delete(id)
	}

	isAllowed(subject: TrustSubject | undefined): boolean {
		return Boolean(
			subject && isTrustedArtifactSource(subject.trustSource) && this.allowances.get(subject.id) === subject.contentHash,
		)
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

/** Directory that holds provenance records written by AI-Hydro's recorded tools. */
export function artifactRecordRoot(): string {
	return process.env.AIHYDRO_ARTIFACT_RECORD_ROOT || path.join(os.homedir(), ".aihydro", "artifact-records")
}

/**
 * A recorded-tool artifact has a record `<root>/<sha256>.json` whose `sha256`
 * equals the SHA-256 of the file's current bytes. The root is under the user's
 * home (or an explicit env override), never inside the workspace, so a cloned
 * repository cannot supply records. A modified file no longer matches its record.
 */
export async function hasRecordedToolProvenance(fsPath: string, root = artifactRecordRoot()): Promise<boolean> {
	try {
		const bytes = await fs.readFile(fsPath)
		const digest = createHash("sha256").update(bytes).digest("hex")
		const record = JSON.parse(await fs.readFile(path.join(root, `${digest}.json`), "utf8")) as {
			schema?: unknown
			sha256?: unknown
		}
		return record.schema === "aihydro-artifact-record-v1" && record.sha256 === digest
	} catch {
		return false
	}
}

function containedBy(candidate: string, parent: string): boolean {
	const relative = path.relative(parent, candidate)
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

/** Marketplace install roots (modules and courses). Their content is unsigned. */
export function marketplaceInstallRoots(home = os.homedir()): string[] {
	return [path.join(home, ".aihydro", "modules"), path.join(home, ".aihydro", "courses")]
}

export function isUnsignedMarketplacePath(fsPath: string, home = os.homedir()): boolean {
	const resolved = path.resolve(fsPath)
	return marketplaceInstallRoots(home).some((root) => containedBy(resolved, root))
}

/**
 * Classify a file about to be registered. `installedPack` is the result of the
 * Learning Pack registry lookup (signature verification happens at pack install).
 */
export async function classifyArtifactFile(
	fsPath: string,
	opts: { installedPack: boolean; home?: string; recordRoot?: string },
): Promise<ArtifactTrustSource> {
	if (opts.installedPack) {
		return "learning-pack"
	}
	if (isUnsignedMarketplacePath(fsPath, opts.home)) {
		return "unsigned-module"
	}
	if (await hasRecordedToolProvenance(fsPath, opts.recordRoot)) {
		return "recorded-tool"
	}
	return "document"
}
