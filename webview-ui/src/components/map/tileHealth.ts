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

/** Overlay sources: tiles that must have been tried before a source can be classified failed. */
export const MIN_OVERLAY_SAMPLE = 8

/**
 * Overlay sources (basemap-<overlay>) are sparse caches: a 404 is "no data here", never an outage. They also
 * need a minimum sample before they can be called failed, so the first few edge tiles cannot raise an alert.
 */
export function isSparseSource(id: string): boolean {
	return id.startsWith("basemap-")
}

export interface ClassifyOptions {
	/** Sparse cache: 404s are excluded from the failure ratio and a minimum sample is required. */
	sparse?: boolean
}

export function classifyTileHealth(tally: TileTally | undefined, options: ClassifyOptions = {}): TileHealth {
	if (!tally || tally.failed === 0) return "ok"
	if (!options.sparse) {
		if (tally.loaded === 0) return "failed"
		return tally.failed / (tally.failed + tally.loaded) >= TILE_FAILURE_RATIO ? "failed" : "partial"
	}
	const realFailures = tally.failed - tally.notFound
	if (realFailures <= 0) return "partial"
	const sample = tally.loaded + realFailures
	if (sample < MIN_OVERLAY_SAMPLE) return "partial"
	return realFailures / sample >= TILE_FAILURE_RATIO ? "failed" : "partial"
}

/** Ids of sources with at least one loaded tile. */
export function loadedSources(tallies: TileTallies): Set<string> {
	return new Set(
		Object.entries(tallies)
			.filter(([, tally]) => tally.loaded > 0)
			.map(([id]) => id),
	)
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
		if (classifyTileHealth(tally, { sparse: isSparseSource(id) }) === "failed")
			errors[id] = tally.lastError ?? "Tile request failed"
	}
	return errors
}

/** Quiet notes for sources with a few missing tiles: source id -> sentence. */
export function tileNotesFrom(tallies: TileTallies): Record<string, string> {
	const notes: Record<string, string> = {}
	for (const [id, tally] of Object.entries(tallies)) {
		if (classifyTileHealth(tally, { sparse: isSparseSource(id) }) !== "partial") continue
		const gaps = tally.notFound
		notes[id] =
			`${tally.failed} tile${tally.failed === 1 ? "" : "s"} unavailable` +
			(gaps > 0 ? ` (${gaps} with no coverage at that location)` : "")
	}
	return notes
}

// ── Placeholder detection ───────────────────────────────────────────────────────────────────────────────────
// Some providers answer HTTP 200 with the same "key required" or "not available" image for every request, so no
// tile ever errors. A provider-independent signal: one source returns byte-identical tiles for (nearly) every
// distinct tile address it was asked for. Real sources do repeat tiles over open ocean or blank areas, so this
// is reported as a non-blocking suspicion ("basemap may be unavailable"), never as a failure.

/** Distinct tile addresses a source must have served before sameness is meaningful. */
export const PLACEHOLDER_MIN_TILES = 12
/** Share of those tiles that must be byte-identical. */
export const PLACEHOLDER_IDENTICAL_RATIO = 0.95

/** Cheap content fingerprint of tile bytes (length plus FNV-1a hash). */
export function fingerprintBytes(bytes: Uint8Array): string {
	let hash = 0x811c9dc5
	for (let i = 0; i < bytes.length; i++) {
		hash ^= bytes[i]
		hash = Math.imul(hash, 0x01000193) >>> 0
	}
	return `${bytes.length}:${hash.toString(16)}`
}

export class TilePlaceholderTracker {
	private bySource = new Map<string, Map<string, Set<string>>>() // source -> fingerprint -> tile addresses

	record(source: string, tileAddress: string, fingerprint: string): void {
		const prints = this.bySource.get(source) ?? new Map<string, Set<string>>()
		const addresses = prints.get(fingerprint) ?? new Set<string>()
		addresses.add(tileAddress)
		prints.set(fingerprint, addresses)
		this.bySource.set(source, prints)
	}

	/** True when `source` looks like it is serving one placeholder image. */
	suspected(source: string): boolean {
		const prints = this.bySource.get(source)
		if (!prints) return false
		let total = 0
		let top = 0
		for (const addresses of prints.values()) {
			total += addresses.size
			top = Math.max(top, addresses.size)
		}
		return total >= PLACEHOLDER_MIN_TILES && top / total >= PLACEHOLDER_IDENTICAL_RATIO
	}

	clear(source?: string): void {
		if (source === undefined) this.bySource.clear()
		else this.bySource.delete(source)
	}
}
