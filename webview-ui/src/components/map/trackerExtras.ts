/**
 * Tracker fields on sketches (status, priority, tags, collections, "Save to My Gallery", batch ask) are off by
 * default: the map's Draw panel is for regions of interest and sketches. The data stays on every annotation and
 * is shown again when this is on. Per viewer, stored in localStorage; the Sketches menu toggles it.
 */
export const TRACKER_EXTRAS_KEY = "aihydro.map.trackerExtras"

/** Anything on a sketch that only the tracker fields show. A user who filled these in has not opted out of them. */
export function hasTrackerData(
	annotations: Array<{ status?: string; priority?: string | null; tags?: string[]; collectionIds?: string[] }>,
): boolean {
	return annotations.some(
		(a) =>
			(a.status && a.status !== "open") || !!a.priority || (a.tags?.length ?? 0) > 0 || (a.collectionIds?.length ?? 0) > 0,
	)
}

/** A saved choice wins. With none, the tracker is on only when saved sketches already hold tracker data. */
export function trackerExtrasEnabled(annotations: Parameters<typeof hasTrackerData>[0] = []): boolean {
	try {
		const saved = localStorage.getItem(TRACKER_EXTRAS_KEY)
		if (saved === "1") return true
		if (saved === "0") return false
	} catch {
		/* storage blocked: fall through to the data check */
	}
	return hasTrackerData(annotations)
}

export function setTrackerExtras(on: boolean): void {
	try {
		localStorage.setItem(TRACKER_EXTRAS_KEY, on ? "1" : "0")
	} catch {
		/* storage can be blocked; the choice then lasts until the panel closes */
	}
}
