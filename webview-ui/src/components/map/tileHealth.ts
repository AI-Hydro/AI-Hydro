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
// distinct tile address it was asked for, AND returns that same image for a fixed land control tile.
//
// The control is essential: real sources repeat tiles over open ocean (Esri World_Light_Gray_Base ocean tiles at
// z5/z6 are byte-identical: 12 of 13 tiles share one 2419-byte image), so sameness inside the viewport alone
// cannot tell a placeholder from sea. A real placeholder is identical everywhere, land included.
//
// Bounded by design: counts per fingerprint over at most PLACEHOLDER_MAX_SAMPLE tiles, a small ring of recent
// addresses for de-duplication, and hashing stops once a decision is reached (`wantsFingerprint`).

/** Distinct tile addresses a source must have served before sameness is meaningful. */
export const PLACEHOLDER_MIN_TILES = 12
/** Share of those tiles that must be byte-identical. */
export const PLACEHOLDER_IDENTICAL_RATIO = 0.95
/** Tiles hashed per source at most; after this the tracker stops asking for fingerprints. */
export const PLACEHOLDER_MAX_SAMPLE = 64
/** Recent addresses remembered for de-duplication (a ring, never an ever-growing set). */
export const PLACEHOLDER_ADDRESS_RING = 128
/** Land control tile (z/x/y over India: land, with coastline and relief) fetched once per source. */
export const CONTROL_TILE = { z: 3, x: 5, y: 3 } as const

/** Fills a `{z}/{x}/{y}` tile URL template with the land control tile address. */
export function controlTileUrl(template: string): string {
	return template
		.replace("{z}", String(CONTROL_TILE.z))
		.replace("{x}", String(CONTROL_TILE.x))
		.replace("{y}", String(CONTROL_TILE.y))
}

/** Cheap content fingerprint of tile bytes (length plus FNV-1a hash); fallback when SubtleCrypto is unavailable. */
export function fingerprintBytes(bytes: Uint8Array): string {
	let hash = 0x811c9dc5
	for (let i = 0; i < bytes.length; i++) {
		hash ^= bytes[i]
		hash = Math.imul(hash, 0x01000193) >>> 0
	}
	return `${bytes.length}:${hash.toString(16)}`
}

/** Fingerprint of a tile blob: SHA-256 prefix via SubtleCrypto (off the main thread), FNV fallback. The blob is read once. */
export async function fingerprintBlob(blob: Blob): Promise<string> {
	const buffer = await blob.arrayBuffer()
	const subtle = typeof crypto !== "undefined" ? crypto.subtle : undefined
	if (subtle) {
		try {
			const digest = new Uint8Array(await subtle.digest("SHA-256", buffer))
			const hex = Array.from(digest.slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("")
			return `${buffer.byteLength}:${hex}`
		} catch {
			// fall through to the plain hash
		}
	}
	return fingerprintBytes(new Uint8Array(buffer))
}

export class TilePlaceholderTracker {
	private counts = new Map<string, number>() // fingerprint -> tiles
	private total = 0
	private ring: string[] = []
	private recent = new Set<string>()
	private control: string | undefined
	private decided = false

	/** True while hashing tiles is still useful. Callers skip the work (and the blob read) once this is false. */
	wantsFingerprint(): boolean {
		return !this.decided
	}

	record(tileAddress: string, fingerprint: string): void {
		if (this.decided || this.recent.has(tileAddress)) return
		this.recent.add(tileAddress)
		this.ring.push(tileAddress)
		if (this.ring.length > PLACEHOLDER_ADDRESS_RING) this.recent.delete(this.ring.shift() as string)
		this.counts.set(fingerprint, (this.counts.get(fingerprint) ?? 0) + 1)
		this.total += 1
		if (this.total >= PLACEHOLDER_MAX_SAMPLE && this.dominant() === undefined) this.decided = true
	}

	/** The fingerprint shared by nearly every tile seen, once enough tiles were seen. */
	dominant(): string | undefined {
		if (this.total < PLACEHOLDER_MIN_TILES) return undefined
		let top: string | undefined
		let topCount = 0
		for (const [fingerprint, count] of this.counts) {
			if (count > topCount) {
				top = fingerprint
				topCount = count
			}
		}
		return top !== undefined && topCount / this.total >= PLACEHOLDER_IDENTICAL_RATIO ? top : undefined
	}

	/** True when the viewport looks uniform and the land control tile has not been fetched yet. */
	needsControl(): boolean {
		return !this.decided && this.control === undefined && this.dominant() !== undefined
	}

	/** Records the control tile's fingerprint. A control that differs from the dominant image clears the suspicion for good. */
	setControl(fingerprint: string): void {
		this.control = fingerprint
		if (this.dominant() !== fingerprint) this.decided = true
	}

	/** True when a source returns the same image for the viewport and for the land control tile. */
	suspected(): boolean {
		const dominant = this.dominant()
		return dominant !== undefined && this.control !== undefined && this.control === dominant
	}

	clear(): void {
		this.counts.clear()
		this.total = 0
		this.ring = []
		this.recent.clear()
		this.control = undefined
		this.decided = false
	}
}
