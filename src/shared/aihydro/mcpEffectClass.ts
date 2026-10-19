/**
 * Effect class of an MCP tool, derived from its annotations with the MCP-spec defaults for absent hints
 * (readOnlyHint=false, destructiveHint=true, openWorldHint=true). Pure and host-free.
 *
 * Annotations are HINTS from the server and are untrusted unless the server is trusted (isServerTrusted in
 * firstPartyServers.ts): callers must combine this class with that test. Hints must be JSON booleans; a string
 * "true" counts as absent (and so takes the conservative spec default).
 *
 *   no annotations object                       -> UNKNOWN
 *   readOnlyHint === true, openWorld false      -> READ
 *   readOnlyHint === true, openWorld (default)  -> NETWORK
 *   otherwise: destructive (default true)       -> DESTRUCTIVE
 *              else openWorld (default true)    -> NETWORK
 *              else                             -> WRITE
 *
 * A tool that sends only `readOnlyHint: true` is therefore NETWORK, not READ: it has not said it is closed-world.
 */

export type EffectClass = "READ" | "WRITE" | "NETWORK" | "DESTRUCTIVE" | "UNKNOWN"

export interface EffectAnnotations {
	title?: unknown
	readOnlyHint?: unknown
	destructiveHint?: unknown
	idempotentHint?: unknown
	openWorldHint?: unknown
}

const hint = (value: unknown, specDefault: boolean): boolean => (typeof value === "boolean" ? value : specDefault)

export function effectClass(annotations: EffectAnnotations | null | undefined): EffectClass {
	if (!annotations || typeof annotations !== "object") {
		return "UNKNOWN"
	}
	const readOnly = annotations.readOnlyHint === true
	const openWorld = hint(annotations.openWorldHint, true)
	if (readOnly) {
		return openWorld ? "NETWORK" : "READ"
	}
	if (hint(annotations.destructiveHint, true)) {
		return "DESTRUCTIVE"
	}
	return openWorld ? "NETWORK" : "WRITE"
}
