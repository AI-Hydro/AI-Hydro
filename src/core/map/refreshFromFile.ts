import { EVIDENCE_KEYS, hasEvidenceLink, planMerge } from "@shared/map/layerIdentity"
import { FACT_KEYS_KEY, LAYER_FACT_KEYS } from "@shared/map/provenanceEnvelope"
import { MapLayer } from "@shared/proto/cline/map"

/** What the host saw of a file when it read it: the version the layer is about to hold. */
export interface FileSnapshot {
	sizeBytes: number
	mtimeMs: number
	sha256: string
}

/**
 * Keys a parse of the new file may not set. The host decides the layer's file, its status and its links; the page that
 * parsed the bytes only supplies what describes them (format, feature counts, the converted copy).
 */
const NOT_FROM_PARSE = new Set<string>([
	...EVIDENCE_KEYS,
	...LAYER_FACT_KEYS,
	FACT_KEYS_KEY,
	"session_id",
	"chat_id",
	"provenance_path",
	"retrieved_at",
	"agent_step",
	"_prior_run_id",
	"_hydrated",
	"__operation",
	"source",
	"path",
	"workspace_path",
	"workspace_folder",
	"display_name",
])

/** The `source_*` keys that describe how the bytes were read. Every other `source_*` key is the host's. */
const PARSE_SOURCE_KEYS = new Set(["source_format", "source_derived_from"])

export type RefreshOutcome = { ok: true; layer: MapLayer; priorRun?: string } | { ok: false; reason: string }

/**
 * The layer after its file changed and the new version was read and parsed. Pure; the controller applies it.
 *
 * The layer stays the same layer: id, name, style, visibility and its place in the order are not touched, and nothing here
 * can move the camera. Its content, and the keys that describe the content, are the new file's.
 *
 * `mode: "auto"` is a watcher update and is refused for any layer with an evidence link (a run, a study, a tool or a claim):
 * its content stands for something recorded elsewhere, so only `mode: "use_new_file"`, the user's own choice, replaces it,
 * and the link is removed with the content it vouched for.
 */
export function refreshLayerFromFile(
	existing: MapLayer,
	update: { geojson: string; metadata?: Record<string, string>; snapshot: FileSnapshot; updatedAtIso: string },
	mode: "auto" | "use_new_file",
): RefreshOutcome {
	if (mode === "auto" && hasEvidenceLink(existing.metadata)) {
		return { ok: false, reason: "The layer is linked to a run, so it does not change by itself." }
	}
	if (!update.geojson) {
		return { ok: false, reason: "The new version has no content." }
	}
	const parsed: Record<string, string> = {}
	for (const [key, value] of Object.entries(update.metadata ?? {})) {
		if (typeof value !== "string" || value === "") continue
		if (
			NOT_FROM_PARSE.has(key) ||
			(key.startsWith("source_") && !PARSE_SOURCE_KEYS.has(key)) ||
			key.startsWith("_fact") ||
			(key.endsWith("id") && key.includes("run"))
		)
			continue
		parsed[key] = value
	}
	const incoming = {
		id: `${existing.id}::refresh`,
		layerType: existing.layerType,
		geojson: update.geojson,
		metadata: {
			...parsed,
			source_size_bytes: String(update.snapshot.sizeBytes),
			source_mtime_ms: String(Math.round(update.snapshot.mtimeMs)),
			source_sha256: update.snapshot.sha256,
			source_loaded_at_utc: update.updatedAtIso,
		},
	}
	const plan = planMerge(existing, incoming, "changed")
	const metadata = { ...plan.metadata, source_updated_at_utc: update.updatedAtIso }
	const layer = MapLayer.create({ ...existing, geojson: update.geojson, metadata })
	return { ok: true, layer, ...(plan.priorRun ? { priorRun: plan.priorRun } : {}) }
}
