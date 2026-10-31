/**
 * Tracker fields on sketches (status, priority, tags, collections, "Save to My Gallery", batch ask) are off by
 * default: the map's Draw panel is for regions of interest and sketches. The data stays on every annotation and
 * is shown again when this is on. Per viewer, stored in localStorage; the Sketches menu toggles it.
 */
export const TRACKER_EXTRAS_KEY = "aihydro.map.trackerExtras"

export function trackerExtrasEnabled(): boolean {
	try {
		return localStorage.getItem(TRACKER_EXTRAS_KEY) === "1"
	} catch {
		return false
	}
}

export function setTrackerExtras(on: boolean): void {
	try {
		if (on) {
			localStorage.setItem(TRACKER_EXTRAS_KEY, "1")
		} else {
			localStorage.removeItem(TRACKER_EXTRAS_KEY)
		}
	} catch {
		/* storage can be blocked; the choice then lasts until the panel closes */
	}
}
