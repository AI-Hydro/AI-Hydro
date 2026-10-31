/**
 * What makes two map layers the same file.
 *
 * How a file reached the map (Explorer menu, Add file, the workspace list, a restore, an agent push) says nothing
 * about which file it is, so it must not decide whether there are one or two layers. Identity is, in order:
 *   1. the resolved source path (a layer's own absolute path, or its workspace folder joined with its relative path);
 *   2. when either layer has no path, the content hash.
 * Layers whose runs differ are never the same layer, even with identical content: they are two results, each with
 * its own provenance. Two files whose sizes are both recorded and differ are never the same either.
 */

export interface IdentityLayer {
	id: string
	layerType?: string
	geojson?: string
	metadata?: Record<string, string>
}

const norm = (p: string): string => {
	let out = p.replace(/\\/g, "/").replace(/\/{2,}/g, "/")
	if (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1)
	// Windows paths compare without case; POSIX paths do not.
	return /^[A-Za-z]:\//.test(out) ? out.toLowerCase() : out
}
const isAbsolute = (p: string): boolean => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)

/** The one path this layer's file has on disk, or undefined when the layer does not name a file. */
export function resolvedSourcePath(meta: Record<string, string> | undefined): string | undefined {
	if (!meta) return undefined
	for (const key of ["source_path", "workspace_path"]) {
		const v = meta[key]
		if (v && isAbsolute(v)) return norm(v)
	}
	const rel = meta.path
	if (rel) {
		if (isAbsolute(rel)) return norm(rel)
		if (meta.workspace_folder) return norm(`${meta.workspace_folder}/${rel}`)
	}
	return undefined
}

/** FNV-1a over the string (two 32-bit lanes), with the length. An identity check, not security. */
export function contentHash(text: string): string {
	let h1 = 0x811c9dc5
	let h2 = 0x01000193
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i)
		h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
		h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0
	}
	return `${text.length}:${h1.toString(16)}${h2.toString(16)}`
}

const runOf = (l: IdentityLayer): string | undefined => l.metadata?._run_id || undefined

/** True when both layers are the same file. A layer is never a duplicate of itself. */
export function sameFile(a: IdentityLayer, b: IdentityLayer): boolean {
	if (a.id === b.id) return false
	const ra = runOf(a)
	const rb = runOf(b)
	if (ra && rb && ra !== rb) return false
	const sa = a.metadata?.source_size_bytes
	const sb = b.metadata?.source_size_bytes
	if (sa && sb && sa !== sb) return false
	const pa = resolvedSourcePath(a.metadata)
	const pb = resolvedSourcePath(b.metadata)
	if (pa && pb) return pa === pb
	// A workspace load labels every file a polygon layer, so the type only counts when content decides.
	// If one names a file and the other does not, only identical content says they are the same.
	if (a.layerType !== b.layerType) return false
	return !!a.geojson && !!b.geojson && contentHash(a.geojson) === contentHash(b.geojson)
}

export function findDuplicate<T extends IdentityLayer>(layers: T[], candidate: IdentityLayer): T | undefined {
	return layers.find((l) => sameFile(l, candidate))
}

/** Keys that carry a layer's provenance and where it came from. Copied, never overwritten. */
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
	"citation",
	"license",
]

/**
 * The metadata of the layer that stays after a merge: its own, plus any provenance or source key the other layer
 * had and it lacked. A run link on either side survives. Nothing the kept layer already says is replaced.
 */
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

/** Which of two duplicates to keep: the one with a run (provenance), then the one earlier in map order. */
export function preferKept<T extends IdentityLayer>(a: T, b: T, order: string[]): T {
	const pa = runOf(a) ? 1 : 0
	const pb = runOf(b) ? 1 : 0
	if (pa !== pb) return pa > pb ? a : b
	// A layer not in the order yet (a new one) comes after every layer that is.
	const at = (l: IdentityLayer) => (order.includes(l.id) ? order.indexOf(l.id) : Number.POSITIVE_INFINITY)
	return at(a) <= at(b) ? a : b
}

export interface MergePlan {
	/** The layer that stays: the one with provenance, else the one already on the map. */
	winner: "existing" | "incoming"
	keptId: string
	/** The id to remove from the map, when the survivor is the incoming layer. */
	removedId?: string
	/** The survivor's metadata: its own plus any run or source key the other had. */
	metadata: Record<string, string>
	/** The new order: the survivor takes the existing layer's place; nothing else moves. */
	order: string[]
}

/** What to do when the same file arrives a second time. Pure; the controller applies it. */
export function planMerge(existing: IdentityLayer, incoming: IdentityLayer, order: string[]): MergePlan {
	const winner = preferKept(existing, incoming, order) === existing ? "existing" : "incoming"
	const kept = winner === "existing" ? existing : incoming
	const lost = winner === "existing" ? incoming : existing
	return {
		winner,
		keptId: kept.id,
		...(winner === "incoming" ? { removedId: existing.id } : {}),
		metadata: mergedMetadata(kept.metadata, lost.metadata),
		order: winner === "incoming" ? order.map((id) => (id === existing.id ? kept.id : id)) : order,
	}
}
