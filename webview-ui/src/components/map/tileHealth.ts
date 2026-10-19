/**
 * Tile-source health: turns individual tile successes and failures into one honest status per source.
 *
 * Previously one failed tile raised a permanent "Map display incomplete" alert that never cleared when later
 * tiles loaded. Sparse-cache 404s are normal for ArcGIS caches, so a single miss is a note, not an alert.
 *
 *   ok       no failures
 *   partial  some tiles failed but the source mostly works  -> small status note
 *   failed   nothing loaded, or the failure share is at least TILE_FAILURE_RATIO -> alert with Retry
 *
 * Counts are per source (the basemap, or a layer id) and are reset when the source changes (basemap switch,
 * Retry), so an error from a previous basemap can never stay on screen.
 */

export interface TileTally {
	loaded: number
	failed: number
	/** Failures that were HTTP 404 (no tile at that address: coverage gap, not an outage). */
	notFound: number
	lastError?: string
}

export type TileHealth = "ok" | "partial" | "failed"
export type TileTallies = Record<string, TileTally>

/** Failure share at or above which a source is reported as failed. */
export const TILE_FAILURE_RATIO = 0.25

export function classifyTileHealth(tally: TileTally | undefined): TileHealth {
	if (!tally || tally.failed === 0) return "ok"
	if (tally.loaded === 0) return "failed"
	return tally.failed / (tally.failed + tally.loaded) >= TILE_FAILURE_RATIO ? "failed" : "partial"
}

export function isNotFoundMessage(message: string): boolean {
	return /\bHTTP 404\b/.test(message)
}

export type TileOutcome = { ok: true } | { ok: false; message: string }

export function tallyTile(previous: TileTallies, id: string, outcome: TileOutcome): TileTallies {
	const current = previous[id] ?? { loaded: 0, failed: 0, notFound: 0 }
	const next: TileTally = outcome.ok
		? { ...current, loaded: current.loaded + 1 }
		: {
				...current,
				failed: current.failed + 1,
				notFound: current.notFound + (isNotFoundMessage(outcome.message) ? 1 : 0),
				lastError: outcome.message,
			}
	return { ...previous, [id]: next }
}

export function clearTally(previous: TileTallies, id: string): TileTallies {
	if (!(id in previous)) return previous
	const { [id]: _removed, ...rest } = previous
	return rest
}

/** Alert-level errors: source id -> last error message. */
export function tileErrorsFrom(tallies: TileTallies): Record<string, string> {
	const errors: Record<string, string> = {}
	for (const [id, tally] of Object.entries(tallies)) {
		if (classifyTileHealth(tally) === "failed") errors[id] = tally.lastError ?? "Tile request failed"
	}
	return errors
}

/** Quiet notes for sources with a few missing tiles: source id -> sentence. */
export function tileNotesFrom(tallies: TileTallies): Record<string, string> {
	const notes: Record<string, string> = {}
	for (const [id, tally] of Object.entries(tallies)) {
		if (classifyTileHealth(tally) !== "partial") continue
		const gaps = tally.notFound
		notes[id] =
			`${tally.failed} tile${tally.failed === 1 ? "" : "s"} unavailable` +
			(gaps > 0 ? ` (${gaps} with no coverage at that location)` : "")
	}
	return notes
}
