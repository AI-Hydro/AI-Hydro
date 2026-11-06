/**
 * What a layer says about its file in the Layers drawer, in words that only claim what is true.
 *
 * A layer that follows its file by itself says so once it has (`Updated from the file on disk at 14:03.`). A layer with an
 * evidence link (a run, a study, a tool, a claim) never changes by itself: it says its file changed and offers
 * `Use new file`. A line about a copy ("the map still shows the run's result") is written only when the layer holds one.
 */

import { hasEvidenceLink } from "@shared/map/layerIdentity"
import type { MapLayer } from "@shared/proto/cline/map"

/** Layer types whose file cannot be re-read in place. */
const NOT_IN_PLACE = new Set(["raster", "inundation_3d", "gee_tile"])

export interface SourceNote {
	kind: "changed" | "changed_manual" | "unreadable" | "missing" | "updated" | "not_watched"
	text: string
	/** With a note about a changed file that has a link: the user may choose the new file, after this question. */
	useNewFile?: { question: string }
}

/** The last segment of a run id: `dfetch.20261017.e2eproo.48d4b668` reads `48d4b668`. */
export const runTag = (runId: string): string => runId.split(".").pop() || runId

/** True when the layer holds the content it had when the link was made, so the map is not drawing the file as it is now. */
export function holdsLinkedCopy(layer: MapLayer): boolean {
	const meta = layer.metadata ?? {}
	return !!(layer.geojson || meta.geojson_cache_path || meta.display_geojson_path)
}

function timeOf(iso: string): string {
	const d = new Date(iso)
	return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

export function sourceNote(layer: MapLayer): SourceNote | undefined {
	const meta = layer.metadata ?? {}
	const status = meta.source_status
	const linked = hasEvidenceLink(meta)
	const run = meta._run_id
	if (status === "source_unreadable") {
		return {
			kind: "unreadable",
			text: `Could not read the new version: ${meta.source_error || "the file is not a readable map layer"}. Showing the last good copy.`,
		}
	}
	if (status === "source_missing") {
		const where = meta.source_display_path || meta.source_path || meta.path || "the source file"
		return { kind: "missing", text: `File not found: ${where}. Showing the last loaded copy.` }
	}
	if (status === "source_changed") {
		if (!linked) {
			return {
				kind: "changed_manual",
				text: "The file changed on disk. This layer does not update by itself. Remove it and load the file again.",
			}
		}
		if (NOT_IN_PLACE.has(layer.layerType)) {
			// A raster cannot take a new file in place, so no button: offering one would promise what the host cannot do.
			return {
				kind: "changed",
				text: `The file changed ${run ? "after this run" : "after this layer's evidence was recorded"}. The layer keeps what it was made from. Load the file again to use the new version.`,
			}
		}
		const after = run ? "after this run" : "after this layer's evidence was recorded"
		const shows = holdsLinkedCopy(layer)
			? ` The map still shows ${run ? "the run's result" : "the recorded result"}.`
			: " The map draws the file as it is now, so it may not match."
		return {
			kind: "changed",
			text: `The file changed ${after}.${shows}`,
			useNewFile: {
				question: `Use the new file? The link to ${run ? `run ${runTag(run)}` : "its evidence"} will be removed, because this content did not come from ${run ? "that run" : "it"}.`,
			},
		}
	}
	if (meta.source_updated_at_utc && !linked) {
		const removed = meta._prior_run_id ? ` The link to run ${runTag(meta._prior_run_id)} was removed.` : ""
		return { kind: "updated", text: `Updated from the file on disk at ${timeOf(meta.source_updated_at_utc)}.${removed}` }
	}
	if (meta.source_watch === "not_watched") {
		return {
			kind: "not_watched",
			text: "Not watched: this file is outside the open folders, so changes to it are not picked up. Add it again to watch it.",
		}
	}
	return undefined
}
