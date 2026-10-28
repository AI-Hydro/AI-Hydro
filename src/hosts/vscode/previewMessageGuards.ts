import * as path from "node:path"

/**
 * Validation for messages the preview shell relays to the extension host. The shell
 * forwards data that originated inside a (possibly hostile) HTML document, so every
 * identity, path and size is derived from, or checked against, the host's own artifact
 * record rather than taken from the message. Pure functions, unit-tested.
 */

export interface ArtifactLookup {
	/** Registered file path of the artifact, or undefined if the id is unknown. */
	fsPath(artifactId: string): string | undefined
	/** Learning Pack scope metadata of the artifact (host-assigned), if any. */
	metadata(artifactId: string): Readonly<Record<string, string>> | undefined
	/** Trusted source AND user allowance AND served from the hashed snapshot. */
	canExecute(artifactId: string): boolean
}

const SAFE_CANONICAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SAFE_KIND = /^[a-z][a-z0-9_.]{0,47}$/
const MAX_PAYLOAD_JSON = 256 * 1024
const MAX_SAVE_BYTES = 50 * 1024 * 1024

export interface RelayedEvent {
	moduleId: string
	cellId?: string
	kind: string
	payloadJson: string
	timestampMs: number
	source: string
}

export interface PreviewEventDecision {
	event: RelayedEvent
	/** Canonical id the artifact's events should be filed under from now on, if it may change. */
	identityMove?: { rawId: string; canonicalId: string }
}

/**
 * Decide what the host records for an `aihydro-preview-event` message.
 * Returns null to drop it (unknown artifact).
 */
export function decidePreviewEvent(
	message: { artifactId?: unknown; kind?: unknown; payloadJson?: unknown; timestampMs?: unknown; source?: unknown },
	lookup: ArtifactLookup,
	fileIdToModuleId: ReadonlyMap<string, string>,
): PreviewEventDecision | null {
	const rawId = typeof message.artifactId === "string" ? message.artifactId : ""
	if (!rawId || lookup.fsPath(rawId) === undefined) {
		return null
	}
	const trusted = lookup.canExecute(rawId)
	let parsed: Record<string, unknown> = {}
	if (typeof message.payloadJson === "string" && message.payloadJson.length <= MAX_PAYLOAD_JSON) {
		try {
			const value = JSON.parse(message.payloadJson)
			if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>
		} catch {
			/* keep empty */
		}
	} else if (typeof message.payloadJson === "string") {
		parsed = { truncated: true }
	}
	const kind = typeof message.kind === "string" && SAFE_KIND.test(message.kind) ? message.kind : "unknown"

	let identityMove: PreviewEventDecision["identityMove"]
	// Only an allowed document may rename its own identity, and never onto an id another
	// artifact already holds (a document must not impersonate another module).
	if (trusted && kind === "manifest.loaded" && typeof parsed.id === "string" && SAFE_CANONICAL_ID.test(parsed.id)) {
		const canonicalId = parsed.id
		const takenByOther = [...fileIdToModuleId.entries()].some(
			([file, canonical]) => file !== rawId && canonical === canonicalId,
		)
		if (!takenByOther && fileIdToModuleId.get(rawId) !== canonicalId && rawId !== canonicalId) {
			identityMove = { rawId, canonicalId }
		}
	}
	const moduleId = identityMove?.canonicalId ?? fileIdToModuleId.get(rawId) ?? rawId
	// The document's own idea of its module id never survives.
	parsed.moduleId = moduleId
	parsed.module_id = moduleId
	return {
		identityMove,
		event: {
			moduleId,
			cellId: typeof parsed.cellId === "string" ? parsed.cellId.slice(0, 128) : undefined,
			kind,
			payloadJson: JSON.stringify(parsed),
			timestampMs: Number(message.timestampMs) || Date.now(),
			source: trusted ? String(message.source ?? "user").slice(0, 32) : "untrusted-document",
		},
	}
}

export type SaveDecision = { ok: true; fsPath: string; html: string } | { ok: false; error: string }

/** A save writes only to the artifact's registered file; a differing claimed path is refused. */
export function decideSaveDocument(
	message: { artifactId?: unknown; filePath?: unknown; html?: unknown },
	lookup: ArtifactLookup,
): SaveDecision {
	const artifactId = typeof message.artifactId === "string" ? message.artifactId : ""
	const registered = artifactId ? lookup.fsPath(artifactId) : undefined
	if (!registered) return { ok: false, error: "Unknown artifact" }
	if (typeof message.html !== "string" || !message.html) return { ok: false, error: "Missing html" }
	if (Buffer.byteLength(message.html, "utf8") > MAX_SAVE_BYTES) return { ok: false, error: "Document too large" }
	if (typeof message.filePath === "string" && message.filePath && path.resolve(message.filePath) !== path.resolve(registered)) {
		return { ok: false, error: "Path does not match the artifact's registered file" }
	}
	return { ok: true, fsPath: registered, html: message.html }
}

function containedBy(candidate: string, parent: string): boolean {
	const relative = path.relative(parent, candidate)
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

export type ActiveCourseDecision = { ok: true; courseId: string; coursePath: string; courseRoot: string } | { ok: false }

/** The active-course pointer may only name a course.json whose folder contains the artifact. */
export function decideActiveCourse(
	message: { artifactId?: unknown; courseId?: unknown; coursePath?: unknown; courseRoot?: unknown },
	lookup: ArtifactLookup,
): ActiveCourseDecision {
	const artifactId = typeof message.artifactId === "string" ? message.artifactId : ""
	const registered = artifactId ? lookup.fsPath(artifactId) : undefined
	if (!registered || typeof message.coursePath !== "string" || typeof message.courseRoot !== "string") return { ok: false }
	const coursePath = path.resolve(message.coursePath)
	const courseRoot = path.resolve(message.courseRoot)
	if (path.basename(coursePath) !== "course.json" || path.dirname(coursePath) !== courseRoot) return { ok: false }
	if (!containedBy(path.resolve(registered), courseRoot)) return { ok: false }
	return { ok: true, courseId: String(message.courseId ?? "").slice(0, 200), coursePath, courseRoot }
}

export type ModuleStateDecision = { ok: true; values: Record<string, string> } | { ok: false; error: string }

const PACK_SCOPE_KEYS: ReadonlyArray<[string, string]> = [
	["packId", "learningPackId"],
	["courseId", "learningPackCourseId"],
	["edition", "learningPackEdition"],
	["moduleId", "learningPackModuleId"],
]

/**
 * Module state is keyed by the artifact's own path (or pack scope); the key in the message
 * must match the host record, and only an allowed document may write values.
 */
export function decideModuleState(
	message: { artifactId?: unknown; action?: unknown; moduleKey?: unknown; values?: unknown; learningPackScope?: unknown },
	lookup: ArtifactLookup,
): ModuleStateDecision {
	const artifactId = typeof message.artifactId === "string" ? message.artifactId : ""
	const registered = artifactId ? lookup.fsPath(artifactId) : undefined
	if (!registered) return { ok: false, error: "Unknown artifact" }
	const moduleKey = String(message.moduleKey ?? "")
	if (moduleKey !== registered && moduleKey !== artifactId) return { ok: false, error: "moduleKey does not match the artifact" }
	const claimed = message.learningPackScope
	if (claimed !== undefined && claimed !== null) {
		const meta = lookup.metadata(artifactId) ?? {}
		const scope = claimed as Record<string, unknown>
		for (const [scopeKey, metaKey] of PACK_SCOPE_KEYS) {
			if (scope[scopeKey] !== meta[metaKey]) return { ok: false, error: "learningPackScope does not match the artifact" }
		}
	}
	const values: Record<string, string> = {}
	if (message.action === "set") {
		if (!lookup.canExecute(artifactId)) return { ok: false, error: "Execution is not allowed for this document" }
		const raw = message.values && typeof message.values === "object" ? (message.values as Record<string, unknown>) : {}
		const entries = Object.entries(raw).slice(0, 200)
		for (const [key, value] of entries) {
			if (typeof value === "string" && key.length <= 200 && value.length <= 10_000) values[key] = value
		}
	}
	return { ok: true, values }
}

/**
 * The Studio shell asks the host to (re)send its state once its own message listeners exist
 * (`aihydro-shell-ready`). Replies the host posts while the webview document is being swapped
 * are lost, and the document it eventually settles on never learns of them; this message is
 * the live document's explicit request to catch up.
 *
 * It carries the per-panel token the host embedded in the shell HTML. A sandboxed artifact cannot
 * read the token, so it cannot trigger a re-push. (Shell reloads are serialised by ShellReloadGate
 * and never rebuild the HTML, so the token stays the same across reloads of one panel.)
 */
export function decideShellReady(message: { token?: unknown }, currentToken: string): "repush" | "ignore" {
	if (!currentToken || typeof message.token !== "string" || message.token !== currentToken) {
		return "ignore"
	}
	return "repush"
}
