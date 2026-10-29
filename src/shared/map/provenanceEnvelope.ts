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
	provenance: MapProvenanceEnvelope | undefined,
	legacy: { run_id?: string; session_id?: string },
): Record<string, string> {
	const env = readEnvelope(provenance)
	const runId = env[RUN_ID_KEY] ?? nonEmpty(legacy.run_id)
	const studyId = env.study_id ?? nonEmpty(legacy.session_id)
	return {
		...env,
		...(runId ? { [RUN_ID_KEY]: runId } : {}),
		...(studyId ? { study_id: studyId, session_id: studyId } : {}),
		source: env.source ?? "run_output",
	}
}
