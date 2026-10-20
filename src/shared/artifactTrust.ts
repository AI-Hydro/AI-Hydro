/**
 * Execution-trust model for documents opened in Studio (HTML Preview).
 *
 * A document may ask the Python kernel to run code, or start an agent task,
 * only when ALL of the following hold:
 *   1. its source is trusted: an installed, signed Learning Pack module whose
 *      installed bytes still verify against the signed checksums (checked at load);
 *   2. the user explicitly allowed execution for this document; and
 *   3. the allowance is visible as a badge in the shell, with a revoke action.
 *
 * Everything else is a static document: it gets no kernel bridge and the host
 * rejects its run/agent requests. The host computes the state below and ships it
 * to the webview as read-only `HtmlPreviewItem.metadata`; the webview never
 * derives trust from document content. Shared by the extension host and the
 * webview so the badge and the enforcement read the same definition.
 */

/**
 * Build flag: true only in builds made for the Playwright suite (AIHYDRO_E2E_BUILD=true), false in
 * every other esbuild/vite build, where the `e2e-fixture` source below is compiled out entirely.
 * Undefined (ts-node unit tests) counts as compiled in; the host still gates it on
 * isIsolatedLocalE2E() at run time.
 */
declare const __AIHYDRO_E2E__: boolean | undefined

/** Where a document came from, as determined by the host (never by the document). */
export type ArtifactTrustSource =
	/** Installed, signature-verified Learning Pack module. */
	| "learning-pack"
	/**
	 * Test-only: a fixture the isolated Playwright extension host was told to trust
	 * (see classifyArtifactFile). Never assigned outside isIsolatedLocalE2E().
	 */
	| "e2e-fixture"
	/** Marketplace module/course: downloaded over the network and not signed. */
	| "unsigned-module"
	/** Any other HTML document (workspace file, agent-written inline HTML, external dashboard). */
	| "document"

export const ARTIFACT_TRUST_METADATA_KEYS = {
	source: "trustSource",
	/** "true" when the user has allowed execution for this document right now. */
	allowed: "executionAllowed",
	/** Host-set reason when an installed Learning Pack module failed its load-time integrity check. */
	integrityFailure: "trustIntegrityFailure",
} as const

export function isTrustedArtifactSource(source: ArtifactTrustSource | undefined): boolean {
	if (typeof __AIHYDRO_E2E__ === "undefined" || __AIHYDRO_E2E__) {
		if (source === "e2e-fixture") {
			return true
		}
	}
	return source === "learning-pack"
}

export interface ArtifactTrustState {
	source: ArtifactTrustSource
	/** The document's source is eligible for execution (still needs the user's allowance). */
	trusted: boolean
	/** The user has allowed execution for this document. Only ever true when `trusted`. */
	allowed: boolean
	/** Kernel bridge and agent hand-off are enabled. Equals `trusted && allowed`. */
	canExecute: boolean
	/** Why a Learning Pack module was demoted to a static document (integrity check), if it was. */
	integrityFailure?: string
}

const KNOWN_SOURCES: ArtifactTrustSource[] = ["learning-pack", "unsigned-module", "document"]
if (typeof __AIHYDRO_E2E__ === "undefined" || __AIHYDRO_E2E__) {
	KNOWN_SOURCES.push("e2e-fixture")
}

/** Fail closed: anything missing or malformed is an untrusted, static document. */
export function readArtifactTrust(metadata: Readonly<Record<string, string>> | undefined): ArtifactTrustState {
	const raw = metadata?.[ARTIFACT_TRUST_METADATA_KEYS.source]
	const source = KNOWN_SOURCES.find((s) => s === raw) ?? "document"
	const trusted = isTrustedArtifactSource(source)
	const allowed = trusted && metadata?.[ARTIFACT_TRUST_METADATA_KEYS.allowed] === "true"
	const failure = metadata?.[ARTIFACT_TRUST_METADATA_KEYS.integrityFailure]
	const integrityFailure = typeof failure === "string" && failure ? failure.slice(0, 300) : undefined
	return { source, trusted, allowed, canExecute: trusted && allowed, ...(integrityFailure ? { integrityFailure } : {}) }
}

export function describeArtifactTrust(state: ArtifactTrustState): { label: string; detail: string } {
	if (typeof __AIHYDRO_E2E__ === "undefined" || __AIHYDRO_E2E__) {
		if (state.source === "e2e-fixture") {
			return state.allowed
				? { label: "Execution allowed", detail: "Test fixture. Python and agent hand-off are enabled for this document." }
				: { label: "Trusted, execution off", detail: "Test fixture. Allow it to enable Python and agent hand-off." }
		}
	}
	if (state.integrityFailure) {
		return {
			label: "Failed integrity check",
			detail: `Learning Pack failed integrity check: ${state.integrityFailure}. Treated as a static document; reinstall the pack to restore it.`,
		}
	}
	switch (state.source) {
		case "learning-pack": {
			const origin = "Signed Learning Pack module"
			return state.allowed
				? { label: "Execution allowed", detail: `${origin}. Python and agent hand-off are enabled for this document.` }
				: { label: "Trusted, execution off", detail: `${origin}. Allow it to enable Python and agent hand-off.` }
		}
		case "unsigned-module":
			return {
				label: "Read-only course copy",
				detail: "This copy was downloaded without a signature, so AI-Hydro will not run its Python. Install the signed Learning Pack to run cells.",
			}
		default:
			return {
				label: "Static document",
				detail: "Not a trusted AI-Hydro artifact. No Python kernel and no agent access.",
			}
	}
}
