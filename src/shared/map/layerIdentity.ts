/**
 * What makes two map layers the same file, and what to do when the same file arrives again.
 *
 * How a file reached the map (Explorer menu, Add file, the workspace list, a restore, an agent push) says nothing
 * about which file it is, so it must not decide whether there are one or two layers. Identity is, in order:
 *   1. the resolved source path (a layer's own absolute path, or its workspace folder joined with its relative path),
 *      with `.` and `..` resolved and, on the host, symlinks resolved;
 *   2. when either layer names no path, the content.
 * Then there are three outcomes (`matchFile`):
 *   - "different": two layers. Two different runs, two different tools, two paths, or two recorded sizes are never one.
 *   - "same": one layer. The existing one stays; the other's run link and source keys are copied onto it.
 *   - "changed": the same path with different content (a reload, an overwritten file, an agent re-push). The existing
 *     layer is updated in place: id, style, visibility and order stay, the content is the new content.
 */

import { FACT_KEYS_KEY, LAYER_FACT_KEYS } from "./provenanceEnvelope"

export interface IdentityLayer {
	id: string
	layerType?: string
	geojson?: string
	metadata?: Record<string, string>
}

export type PathResolver = (path: string) => string

/** Collapse `//`, `.` and `..`; backslashes become `/`; Windows paths compare without case. */
function norm(p: string): string {
	const slashed = p.replace(/\\/g, "/")
	const drive = /^[A-Za-z]:/.test(slashed) ? slashed.slice(0, 2) : ""
	const rooted = slashed.slice(drive.length).startsWith("/")
	const parts: string[] = []
	for (const part of slashed.slice(drive.length).split("/")) {
		if (part === "" || part === ".") continue
		if (part === "..") {
			if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop()
			else if (!rooted) parts.push("..")
			continue
		}
		parts.push(part)
	}
	const out = `${drive}${rooted ? "/" : ""}${parts.join("/")}`
	return drive ? out.toLowerCase() : out
}
const isAbsolute = (p: string): boolean => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)

/** The one path this layer's file has on disk, or undefined when the layer does not name a file. */
export function resolvedSourcePath(meta: Record<string, string> | undefined, realpath?: PathResolver): string | undefined {
	if (!meta) return undefined
	const finish = (p: string): string => {
		const n = norm(p)
		if (!realpath) return n
		try {
			return norm(realpath(n))
		} catch {
			return n
		}
	}
	for (const key of ["source_path", "workspace_path"]) {
		const v = meta[key]
		if (!v) continue
		if (isAbsolute(v)) return finish(v)
		// A relative path names the same file as its folder joined with it (a layer saved before paths were absolute).
		if (meta.workspace_folder) return finish(`${meta.workspace_folder}/${v}`)
	}
	const rel = meta.path
	if (rel) {
		if (isAbsolute(rel)) return finish(rel)
		if (meta.workspace_folder) return finish(`${meta.workspace_folder}/${rel}`)
	}
	return undefined
}

/**
 * A path as a shared output (a map plate sidecar, an export record) should carry it: relative to the project folder when
 * it lies inside it, so the user's home directory is not written into a file that leaves the machine. A path outside the
 * folder, or with no folder given, is returned as it is: it cannot be made relative, and dropping it would lose where the
 * data came from.
 */
export function pathForExport(p: string | undefined, workspaceFolder: string | undefined): string | undefined {
	if (!p || !workspaceFolder || !isAbsolute(p)) return p
	const file = norm(p)
	const folder = norm(workspaceFolder).replace(/\/$/, "")
	return file.startsWith(`${folder}/`) ? file.slice(folder.length + 1) : p
}

/** A short, stable tag for a resolved path, for ids: two files with one name in two folders must not share an id. */
export function pathHash(resolvedPath: string): string {
	let h = 0x811c9dc5
	for (let i = 0; i < resolvedPath.length; i++) {
		h ^= resolvedPath.charCodeAt(i)
		h = Math.imul(h, 0x01000193)
	}
	return (h >>> 0).toString(16).padStart(8, "0").slice(0, 6)
}

/** Above this many characters a layer's two copies are compared as text only: parsing both would cost more than it saves. */
const PARSED_COMPARE_MAX_CHARS = 2_000_000

function sameJson(a: unknown, b: unknown): boolean {
	if (a === b) return true
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
	if (Array.isArray(a) !== Array.isArray(b)) return false
	if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameJson(v, b[i]))
	const ka = Object.keys(a)
	const kb = Object.keys(b)
	if (ka.length !== kb.length) return false
	return ka.every((k) => Object.hasOwn(b, k) && sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/**
 * True when both layers carry content to compare and it is the same. Identical strings are the same at once. Copies
 * that differ as text (one pretty-printed, one compact; a cache copy of a project file) are the same file when they
 * parse to the same value, key order aside, so formatting never makes a second layer. Past a size limit only the text decides.
 */
export function sameContent(a: IdentityLayer, b: IdentityLayer): boolean | undefined {
	if (!a.geojson || !b.geojson) return undefined
	if (a.geojson === b.geojson) return true
	if (a.geojson.length > PARSED_COMPARE_MAX_CHARS || b.geojson.length > PARSED_COMPARE_MAX_CHARS) return false
	try {
		return sameJson(JSON.parse(a.geojson), JSON.parse(b.geojson))
	} catch {
		return false
	}
}

/** Two copies of a layer's content are the same value, whatever their formatting. */
export const sameGeojson = (a: string, b: string): boolean =>
	sameContent({ id: "a", geojson: a }, { id: "b", geojson: b }) === true

const runOf = (l: IdentityLayer): string | undefined => l.metadata?._run_id || undefined

/** Keys that tie a layer to evidence: the run, the study, the tool or the claim it supports. */
export const EVIDENCE_KEYS = ["_run_id", "study_id", "tool", "claim_id"] as const

/**
 * True when the layer's content stands for something recorded elsewhere. Such a layer never changes content by itself:
 * a new version of its file is announced, and only the user's choice (`Use new file`) replaces what the evidence is about.
 */
export function hasEvidenceLink(meta: Record<string, string> | undefined): boolean {
	return !!meta && EVIDENCE_KEYS.some((key) => !!meta[key])
}

export type FileMatch = "different" | "same" | "changed"

/** What the incoming layer is to the existing one. A layer is never a duplicate of itself. */
export function matchFile(existing: IdentityLayer, incoming: IdentityLayer, realpath?: PathResolver): FileMatch {
	if (existing.id === incoming.id) return "different"
	const re = runOf(existing)
	const ri = runOf(incoming)
	if (re && ri && re !== ri) return "different"
	// Two layers that two different tools made are two results, even with the same content.
	const te = existing.metadata?.tool
	const ti = incoming.metadata?.tool
	if (te && ti && te !== ti) return "different"
	const pe = resolvedSourcePath(existing.metadata, realpath)
	const pi = resolvedSourcePath(incoming.metadata, realpath)
	if (pe && pi) {
		if (pe !== pi) return "different"
		const same = sameContent(existing, incoming)
		if (same === false) return "changed"
		if (same === undefined) {
			// One side has no content here, so nothing says the two hold the same bytes. A run link is a claim about
			// content: it must not move onto content that was not compared. When the two differ in whether they name a
			// run, the incoming layer can only replace the existing content (and the run link follows what was
			// replaced, see `planMerge`); an incoming layer with nothing to bring is not the same layer.
			if (re !== ri) return incoming.geojson ? "changed" : "different"
			// An empty incoming side (a restored layer) has nothing to put in its place, so it is the same file.
			const se = existing.metadata?.source_size_bytes
			const si = incoming.metadata?.source_size_bytes
			return incoming.geojson && se && si && se !== si ? "changed" : "same"
		}
		return same ? "same" : "changed"
	}
	// One or both name no file: only identical content says they are the same, and sizes must not disagree.
	const se = existing.metadata?.source_size_bytes
	const si = incoming.metadata?.source_size_bytes
	if (se && si && se !== si) return "different"
	// A workspace load labels every file a polygon layer, so the type only counts when content decides.
	if (existing.layerType !== incoming.layerType) return "different"
	return sameContent(existing, incoming) === true ? "same" : "different"
}

export const sameFile = (a: IdentityLayer, b: IdentityLayer, realpath?: PathResolver): boolean =>
	matchFile(a, b, realpath) !== "different"

export function findDuplicate<T extends IdentityLayer>(
	layers: T[],
	candidate: IdentityLayer,
	realpath?: PathResolver,
): { layer: T; match: "same" | "changed" } | undefined {
	for (const layer of layers) {
		const match = matchFile(layer, candidate, realpath)
		if (match !== "different") return { layer, match }
	}
	return undefined
}

/** Keys that tie a layer to the run that made its content. */
const RUN_LINK_KEYS = [
	"_run_id",
	"tool",
	"study_id",
	"session_id",
	"chat_id",
	"retrieved_at",
	"provenance_path",
	"agent_step",
	"claim_id",
]
/** Keys that carry a layer's provenance and where it came from. Copied when missing, never overwritten. */
const KEEP_KEYS = [
	"_run_id",
	"tool",
	"study_id",
	"session_id",
	"chat_id",
	"retrieved_at",
	"provenance_path",
	"agent_step",
	"claim_id",
	"source_path",
	"workspace_path",
	"path",
	"workspace_folder",
	"source_display_path",
	"source_uri",
	"source_format",
	"source_size_bytes",
	"source_mtime_ms",
	"source_status",
	"validation_status",
	"uncertainty",
	"units",
	"crs",
	"coverage_status",
	"citation",
	"license",
]

/**
 * The metadata of the layer that stays: its own, plus any key the other had and it lacked.
 * A run link (and the keys that go with it) is a claim about content, so it is copied onto a layer that has none only
 * when `contentVerified`: both copies were compared and are the same. Without that, the survivor keeps no run link it did
 * not already have.
 */
export function mergedMetadata(
	keep: Record<string, string> | undefined,
	other: Record<string, string> | undefined,
	contentVerified = false,
): Record<string, string> {
	const out = { ...(keep ?? {}) }
	const keepsRun = !!out._run_id
	for (const key of KEEP_KEYS) {
		if (!contentVerified && !keepsRun && RUN_LINK_KEYS.includes(key)) continue
		if (!out[key] && other?.[key]) out[key] = other[key]
	}
	return out
}

/** Which of two layers has the provenance, then which is earlier in map order. Used to pick what to show, not what to keep. */
export function preferKept<T extends IdentityLayer>(a: T, b: T, order: string[]): T {
	const pa = runOf(a) ? 1 : 0
	const pb = runOf(b) ? 1 : 0
	if (pa !== pb) return pa > pb ? a : b
	const at = (l: IdentityLayer) => (order.includes(l.id) ? order.indexOf(l.id) : Number.POSITIVE_INFINITY)
	return at(a) <= at(b) ? a : b
}

/** Keys the user set on a layer. A reload never replaces them. */
const USER_KEYS = ["display_name", "symbology_user_override", "graduated_attr", "graduated_breaks", "graduated_colors", "legend"]
/** Keys that belong to the run that made the content. They leave with it when the content changes under them. */
const RUN_KEYS = ["_run_id", "tool", "provenance_path", "retrieved_at", "agent_step", "claim_id"]
/**
 * Keys describing the content as it was drawn: a simplified preview made from it, and what was said about the file after
 * it. When the content is replaced they are stale, so they go unless the incoming layer brings its own.
 */
const CONTENT_DERIVED_KEYS = [
	"display_geojson_path",
	"display_mode",
	"original_feature_count",
	"preview_feature_count",
	"original_coord_count",
	"preview_coord_count",
	"preview_bytes",
	"full_geojson_embedded",
	"simplified",
	"simplified_coord_count",
	"source_seen_size_bytes",
	"source_seen_mtime_ms",
	"source_seen_sha256",
	"source_error",
]
/**
 * Annotations that describe the run's result, not the file. When the run link goes, these go too unless the incoming
 * layer supplies them, so old annotations never sit beside new content.
 */
const RUN_ANNOTATION_KEYS = [
	"study_id",
	"session_id",
	"chat_id",
	"run_id",
	"uncertainty",
	"validation_status",
	"coverage_status",
	"citation",
	"license",
	"units",
	"crs",
]

export interface MergePlan {
	/** "merge": same content, one layer. "update": the file changed, the layer takes the new content. */
	kind: "merge" | "update"
	/** The layer that stays: always the one already on the map, so its id, style, visibility and order do not move. */
	keptId: string
	/** The incoming layer's id, now an alias of `keptId`. */
	aliasId: string
	/** The survivor's metadata. */
	metadata: Record<string, string>
	/** With "update": take the incoming content (geojson). */
	takeContent: boolean
	/** With "update": the run whose link was removed because the file changed since it. */
	priorRun?: string
}

/**
 * What to do when the same file arrives again. Pure; the controller applies it. The existing layer always survives,
 * so opacity, aliases, saved scenes and the order, all keyed by its id, stay valid, and a hidden layer stays hidden.
 */
export function planMerge(existing: IdentityLayer, incoming: IdentityLayer, match: "same" | "changed"): MergePlan {
	if (match === "same") {
		return {
			kind: "merge",
			keptId: existing.id,
			aliasId: incoming.id,
			metadata: mergedMetadata(existing.metadata, incoming.metadata, sameContent(existing, incoming) === true),
			// A layer that holds no content takes it from the same file arriving again, but never under a run link: the
			// run's content is the run's, and the existing layer is not told it came from that run.
			takeContent: !existing.geojson && !!incoming.geojson && !runOf(existing),
		}
	}
	// An empty value from the incoming side never overwrites a real one.
	const meta: Record<string, string> = { ...(existing.metadata ?? {}) }
	// Layer facts describe the content they were recorded with. The content is changing, so the old ones and their stamp go,
	// and only what the incoming layer itself carries (a stamp it was allowed to bring) replaces them.
	for (const key of [...LAYER_FACT_KEYS, FACT_KEYS_KEY]) delete meta[key]
	for (const [key, value] of Object.entries(incoming.metadata ?? {})) {
		if (value !== "" && value !== undefined) meta[key] = value
	}
	for (const key of USER_KEYS) {
		if (existing.metadata?.[key]) meta[key] = existing.metadata[key]
	}
	for (const key of CONTENT_DERIVED_KEYS) {
		if (!incoming.metadata?.[key]) delete meta[key]
	}
	const re = runOf(existing)
	let priorRun: string | undefined
	if (hasEvidenceLink(existing.metadata) && !hasEvidenceLink(incoming.metadata)) {
		// The content is no longer what the run produced: say so instead of keeping the link. A link that is not a run (a
		// study, a tool, a claim) goes the same way: it vouched for content that is no longer there.
		for (const key of RUN_KEYS) delete meta[key]
		for (const key of RUN_ANNOTATION_KEYS) {
			if (!incoming.metadata?.[key]) delete meta[key]
		}
		if (re) {
			meta._prior_run_id = re
			priorRun = re
		}
	}
	meta.source_status = "current"
	return {
		kind: "update",
		keptId: existing.id,
		aliasId: incoming.id,
		metadata: meta,
		takeContent: !!incoming.geojson,
		...(priorRun ? { priorRun } : {}),
	}
}
