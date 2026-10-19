/**
 * Execution-trust model for documents opened in Studio (HTML Preview).
 *
 * A document may ask the Python kernel to run code, or start an agent task,
 * only when ALL of the following hold:
 *   1. its source is trusted: an installed, signed Learning Pack module, or an
 *      artifact written by AI-Hydro's own recorded tools;
 *   2. the user explicitly allowed execution for this document; and
 *   3. the allowance is visible as a badge in the shell, with a revoke action.
 *
 * Everything else is a static document: it gets no kernel bridge and the host
 * rejects its run/agent requests. The host computes the state below and ships it
 * to the webview as read-only `HtmlPreviewItem.metadata`; the webview never
 * derives trust from document content. Shared by the extension host and the
 * webview so the badge and the enforcement read the same definition.
 */

/** Where a document came from, as determined by the host (never by the document). */
export type ArtifactTrustSource =
	/** Installed, signature-verified Learning Pack module. */
	| "learning-pack"
	/** Artifact written by AI-Hydro's own recorded tools (host-verified provenance record). */
	| "recorded-tool"
	/** Marketplace module/course: downloaded over the network and not signed. */
	| "unsigned-module"
	/** Any other HTML document (workspace file, agent-written inline HTML, external dashboard). */
	| "document"

export const ARTIFACT_TRUST_METADATA_KEYS = {
	source: "trustSource",
	/** "true" when the user has allowed execution for this document right now. */
	allowed: "executionAllowed",
} as const

export function isTrustedArtifactSource(source: ArtifactTrustSource | undefined): boolean {
	return source === "learning-pack" || source === "recorded-tool"
}

export interface ArtifactTrustState {
	source: ArtifactTrustSource
	/** The document's source is eligible for execution (still needs the user's allowance). */
	trusted: boolean
	/** The user has allowed execution for this document. Only ever true when `trusted`. */
	allowed: boolean
	/** Kernel bridge and agent hand-off are enabled. Equals `trusted && allowed`. */
	canExecute: boolean
}

const KNOWN_SOURCES: readonly ArtifactTrustSource[] = ["learning-pack", "recorded-tool", "unsigned-module", "document"]

/** Fail closed: anything missing or malformed is an untrusted, static document. */
export function readArtifactTrust(metadata: Readonly<Record<string, string>> | undefined): ArtifactTrustState {
	const raw = metadata?.[ARTIFACT_TRUST_METADATA_KEYS.source]
	const source = KNOWN_SOURCES.find((s) => s === raw) ?? "document"
	const trusted = isTrustedArtifactSource(source)
	const allowed = trusted && metadata?.[ARTIFACT_TRUST_METADATA_KEYS.allowed] === "true"
	return { source, trusted, allowed, canExecute: trusted && allowed }
}

export function describeArtifactTrust(state: ArtifactTrustState): { label: string; detail: string } {
	switch (state.source) {
		case "learning-pack":
		case "recorded-tool": {
			const origin = state.source === "learning-pack" ? "Signed Learning Pack module" : "AI-Hydro recorded artifact"
			return state.allowed
				? { label: "Execution allowed", detail: `${origin}. Python and agent hand-off are enabled for this document.` }
				: { label: "Trusted, execution off", detail: `${origin}. Allow it to enable Python and agent hand-off.` }
		}
		case "unsigned-module":
			return {
				label: "Unsigned module",
				detail: "Downloaded from the marketplace without a signature. Treated as untrusted: no Python and no agent access.",
			}
		default:
			return {
				label: "Static document",
				detail: "Not a trusted AI-Hydro artifact. No Python kernel and no agent access.",
			}
	}
}
