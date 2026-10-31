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
		if (v && isAbsolute(v)) return finish(v)
	}
	const rel = meta.path
	if (rel) {
		if (isAbsolute(rel)) return finish(rel)
		if (meta.workspace_folder) return finish(`${meta.workspace_folder}/${rel}`)
	}
	return undefined
}

/**
 * True when both layers carry content to compare and it is the same. Strings of different length differ at once;
 * equal lengths are compared by the engine's native string comparison, so nothing is hashed or cached per add.
 */
function sameContent(a: IdentityLayer, b: IdentityLayer): boolean | undefined {
	if (!a.geojson || !b.geojson) return undefined
	return a.geojson.length === b.geojson.length && a.geojson === b.geojson
}

const runOf = (l: IdentityLayer): string | undefined => l.metadata?._run_id || undefined

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
			// One side has no content here. Only an incoming layer that brings content can change the existing one: an
			// empty incoming side (a restored layer) has nothing to put in its place, so it is the same file.
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

/** The metadata of the layer that stays: its own, plus any key the other had and it lacked. A run link on either side survives. */
export function mergedMetadata(
	keep: Record<string, string> | undefined,
	other: Record<string, string> | undefined,
): Record<string, string> {
	const out = { ...(keep ?? {}) }
	for (const key of KEEP_KEYS) {
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
			metadata: mergedMetadata(existing.metadata, incoming.metadata),
			takeContent: false,
		}
	}
	// An empty value from the incoming side never overwrites a real one.
	const meta: Record<string, string> = { ...(existing.metadata ?? {}) }
	for (const [key, value] of Object.entries(incoming.metadata ?? {})) {
		if (value !== "" && value !== undefined) meta[key] = value
	}
	for (const key of USER_KEYS) {
		if (existing.metadata?.[key]) meta[key] = existing.metadata[key]
	}
	const re = runOf(existing)
	const ri = runOf(incoming)
	let priorRun: string | undefined
	if (re && !ri) {
		// The content is no longer what the run produced: say so instead of keeping the link.
		for (const key of RUN_KEYS) delete meta[key]
		for (const key of RUN_ANNOTATION_KEYS) {
			if (!incoming.metadata?.[key]) delete meta[key]
		}
		meta._prior_run_id = re
		priorRun = re
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
