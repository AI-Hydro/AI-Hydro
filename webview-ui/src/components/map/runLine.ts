/**
 * The Run line: what a layer says about the run that made it, and what Open run does for it. Pure, so the wording and
 * the disabled reasons are tested without rendering. The row, its menu and its drawer all read this one function.
 *
 * A run is shown only for a layer that carries `_run_id`. A name, a folder or a path is never evidence of a run.
 */

import { layerRunId, layerTool, NO_RUN_RECORD } from "@shared/map/provenanceEnvelope"
import type { MapLayer } from "@shared/proto/cline/map"
import { originOf } from "./layerModel"

/** What a lookup by file content said about a file with no run link (the host's `study/by-artifact` answer). */
export interface FileRunLookup {
	rule?: string
	sha256?: string
	studyId?: string
}

export type RunLine =
	/** The layer names its study and run: Open run works. */
	| { kind: "openable"; text: string; studyId: string; runId: string }
	/** The layer names a run but no study: Replay has nothing to open. */
	| { kind: "no-study"; text: string; runId: string }
	/** A file whose content hash matched a study's manifest. Read-only text; there is no run to open. */
	| { kind: "matched"; text: string; studyId: string }
	/** No run record. */
	| { kind: "none"; text: string }

/** The matched-by-hash line is allowed for the manifest rule with a recorded sha256, and for nothing else. */
export function hashMatch(lookup: FileRunLookup | undefined): string | undefined {
	return lookup?.rule === "manifest" && !!lookup.sha256 && !!lookup.studyId ? lookup.studyId : undefined
}

export function runLineOf(layer: MapLayer, lookup?: FileRunLookup): RunLine {
	const meta = layer.metadata
	const runId = layerRunId(meta)
	if (runId) {
		const studyId = meta?.study_id
		const tool = layerTool(meta)
		const label = `${tool ? `${tool} · ` : ""}run ${runId}`
		if (studyId) return { kind: "openable", text: label, studyId, runId }
		return { kind: "no-study", text: `Run ${runId}. No study recorded, so it cannot open here.`, runId }
	}
	const matched = hashMatch(lookup)
	if (matched) return { kind: "matched", text: `Study ${matched}, matched by file hash`, studyId: matched }
	return { kind: "none", text: originOf(layer) === "reference" ? "Reference, not in any run." : NO_RUN_RECORD }
}

/** Why Open run is unavailable for this layer, or undefined when it works. Becomes the menu item's disabled reason. */
export function openRunDisabledReason(layer: MapLayer): string | undefined {
	const line = runLineOf(layer)
	if (line.kind === "openable") return undefined
	return line.kind === "no-study" ? "No study recorded" : NO_RUN_RECORD
}

/** Whether the row shows the history icon: Results rows only, and only when the run can open. */
export function showsRunIcon(layer: MapLayer): boolean {
	return originOf(layer) === "tool" && runLineOf(layer).kind === "openable"
}
