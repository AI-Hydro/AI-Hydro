/**
 * The provenance envelope a tool-pushed map layer carries (UX program 2026-11, section 1.1).
 *
 * The tools server stamps these keys inside its `push_*` functions; a value it does not know is omitted,
 * never sent empty. The host adds only `project_id` and the item id. The run key is spelled `_run_id` in
 * layer metadata and nowhere else: one name for the writer (`MapCommandWatcher`), the layer panel and the
 * layer catalogue. A layer without it has no run record, and the UI says so.
 */

/** The one metadata key naming the run row that produced a layer. */
export const RUN_ID_KEY = "_run_id"

/** The keys the tools server stamps on a pushed layer (its `ENVELOPE_KEYS`). */
export const ENVELOPE_KEYS = ["chat_id", "study_id", RUN_ID_KEY, "tool", "retrieved_at", "source"] as const
export type EnvelopeKey = (typeof ENVELOPE_KEYS)[number]

/** The `provenance` object an `add_layer_from_run` command carries, and the same keys on a pushed layer. */
export type MapProvenanceEnvelope = Partial<Record<EnvelopeKey, string>>

/** Keys the host stamps itself. */
export interface HostStampedKeys {
	project_id?: string
	item_id?: string
}

/**
 * The facts a tool may state about the layer its run made: exactly these five, the same list as aihydro-tools'
 * `LAYER_FACT_KEYS`. A key not named here never becomes layer metadata through `provenance` (it was stripped before the
 * facts existed and still is), so a command cannot put a path, a status or a claim link on a layer this way.
 */
export const LAYER_FACT_KEYS = ["gauge_id", "direction", "distance_km", "truncated", "n_features"] as const
export const MAX_LAYER_FACT_LENGTH = 200

/** The layer facts in a provenance object: the allowlisted keys with a plain non-empty string value, cut at 200 characters. */
export function readLayerFacts(provenance: object | undefined | null): Record<string, string> {
	const source = (provenance ?? {}) as Record<string, unknown>
	const out: Record<string, string> = {}
	for (const key of LAYER_FACT_KEYS) {
		const value = source[key]
		if (typeof value !== "string") continue
		const text = value.trim()
		if (text) out[key] = text.slice(0, MAX_LAYER_FACT_LENGTH)
	}
	return out
}

/** What the UI shows for a layer with no `_run_id`. */
export const NO_RUN_RECORD = "No run record"

type MetadataLike = Record<string, string> | undefined | null

function nonEmpty(value: string | undefined): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined
}

/** The envelope keys present (non-empty) in a layer's metadata. Nothing is filled in. */
export function readEnvelope(meta: MetadataLike): MapProvenanceEnvelope {
	const out: MapProvenanceEnvelope = {}
	for (const key of ENVELOPE_KEYS) {
		const value = nonEmpty(meta?.[key])
		if (value) {
			out[key] = value
		}
	}
	return out
}

/** The run id of a layer, or undefined when it has no run record. */
export function layerRunId(meta: MetadataLike): string | undefined {
	return nonEmpty(meta?.[RUN_ID_KEY])
}

/**
 * The tool that pushed a layer. `tool` is the envelope key; `tool_name` is what older hosts wrote and is
 * read only when `tool` is absent.
 */
export function layerTool(meta: MetadataLike): string | undefined {
	return nonEmpty(meta?.tool) ?? nonEmpty(meta?.tool_name)
}

/** When the layer was retrieved or computed: `retrieved_at` (envelope), else the older `timestamp`. */
export function layerRetrievedAt(meta: MetadataLike): string | undefined {
	return nonEmpty(meta?.retrieved_at) ?? nonEmpty(meta?.timestamp)
}

/**
 * Build the layer metadata for an `add_layer_from_run` command. The envelope is copied as given. When it
 * names no `_run_id`, the command's own `run_id` field (the run the caller asked to draw) fills it, since
 * that run was named explicitly. When neither is present the layer has no run record.
 */
export function runLayerMetadata(
	provenance: (MapProvenanceEnvelope & Record<string, unknown>) | undefined,
	legacy: { runId?: string; sessionId?: string },
): Record<string, string> {
	const env = readEnvelope(provenance as MetadataLike)
	const runId = env[RUN_ID_KEY] ?? nonEmpty(legacy.runId)
	const studyId = env.study_id ?? nonEmpty(legacy.sessionId)
	const facts = readLayerFacts(provenance)
	return {
		...facts,
		...(Object.keys(facts).length > 0 ? { [FACT_KEYS_KEY]: Object.keys(facts).join(",") } : {}),
		...env,
		...(runId ? { [RUN_ID_KEY]: runId } : {}),
		...(studyId ? { study_id: studyId, session_id: studyId } : {}),
		source: env.source ?? "run_output",
	}
}

/**
 * Host-written when it adds a layer from a run: the names of the layer facts that came with that run's command. A fact is
 * "recorded on a layer that names a run" when its name is listed here and the layer has a `_run_id`. This is a convention
 * between the host's own paths, not a signature: a layer catalog file edited on disk can still forge it.
 */
export const FACT_KEYS_KEY = "_fact_keys"

/**
 * Metadata keys an `update_layer` command may not set, change or erase: the envelope, the host-written keys
 * and the `session_id` alias of `study_id`. Provenance is written once, by the pushing call and the host.
 */
export const PROTECTED_METADATA_KEYS: ReadonlySet<string> = new Set([
	...ENVELOPE_KEYS,
	"project_id",
	"item_id",
	"session_id",
	FACT_KEYS_KEY,
])

/** `metadata` without the protected keys. (The facts of an existing layer are guarded where patches are merged: `mergeMapLayerPatch`.) */
export function withoutProtectedKeys(metadata: Record<string, string>): Record<string, string> {
	return Object.fromEntries(Object.entries(metadata).filter(([k]) => !PROTECTED_METADATA_KEYS.has(k)))
}

/** The names of the layer facts a layer's `_fact_keys` stamp lists. Empty when it carries no stamp. */
export function stampedFactKeys(meta: MetadataLike): string[] {
	return (meta?.[FACT_KEYS_KEY] ?? "").split(",").filter((k) => (LAYER_FACT_KEYS as readonly string[]).includes(k))
}

/** `metadata` without the `_fact_keys` stamp. The stamp is only ever written by the host when it adds a layer from a run. */
export function withoutFactStamp(metadata: Record<string, string> | undefined): Record<string, string> {
	const { [FACT_KEYS_KEY]: _stamp, ...rest } = metadata ?? {}
	return rest
}
