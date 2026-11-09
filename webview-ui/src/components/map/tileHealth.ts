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
	/** Tiles drawn from a coarser ancestor because their own tile was a 404 (counted in `loaded` too). Detail, not an alert. */
	fromAncestor?: number
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

/** Tile-health id of the streamed vector river tier (see rivers/riverSources.ts). */
const RIVER_TIER_ID = "basemap-rivers"

/**
 * The streamed river tier is unreachable: nothing loaded after a few tries, or at least half of a larger sample
 * failed. The map then draws the bundled Natural Earth rivers and stops requesting river tiles (so this stays true
 * until Retry clears the tally). A tile the archive simply does not contain is an empty tile, not a failure;
 * a missing archive file is reported as "status 404" (not "HTTP 404"), so it counts as a failure here.
 */
export function riverTierDegraded(tally: TileTally | undefined): boolean {
	if (!tally || tally.failed === 0) return false
	if (tally.loaded === 0) return tally.failed >= 3
	return tally.failed >= MIN_OVERLAY_SAMPLE && tally.failed / (tally.failed + tally.loaded) >= 0.5
}

export function riverFallbackMessage(tally: TileTally): string {
	const cause = tally.lastError ? ` (${tally.lastError})` : ""
	return `River tiles could not be loaded${cause}. Showing the coarse bundled Natural Earth rivers instead.`
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

/** Records that a tile already counted as loaded was drawn from a coarser ancestor. */
export function tallyAncestorFill(previous: TileTallies, id: string): TileTallies {
	const current = previous[id] ?? { loaded: 0, failed: 0, notFound: 0 }
	return { ...previous, [id]: { ...current, fromAncestor: (current.fromAncestor ?? 0) + 1 } }
}

/** Per-source detail lines (never shown as a toast): tiles drawn from a coarser zoom. */
export function tileDetailsFrom(tallies: TileTallies): Record<string, string> {
	const details: Record<string, string> = {}
	for (const [id, tally] of Object.entries(tallies)) {
		const n = tally.fromAncestor ?? 0
		if (n > 0)
			details[id] = `${n} tile${n === 1 ? "" : "s"} drawn from a coarser zoom because the provider has none at this zoom`
	}
	return details
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
		if (id === RIVER_TIER_ID && riverTierDegraded(tally)) errors[id] = riverFallbackMessage(tally)
		else if (classifyTileHealth(tally, { sparse: isSparseSource(id) }) === "failed")
			errors[id] = tally.lastError ?? "Tile request failed"
	}
	return errors
}

/** Quiet notes for sources with a few missing tiles: source id -> sentence. */
export function tileNotesFrom(tallies: TileTallies): Record<string, string> {
	const notes: Record<string, string> = {}
	for (const [id, tally] of Object.entries(tallies)) {
		if (id === RIVER_TIER_ID && riverTierDegraded(tally)) continue // shown as an alert with Retry (tileErrorsFrom)
		if (classifyTileHealth(tally, { sparse: isSparseSource(id) }) !== "partial") continue
		// A 404 is a tile the provider does not have here (a hole in its cache, not an outage).
		const missing = tally.notFound
		const other = tally.failed - missing
		const parts: string[] = []
		if (missing > 0) parts.push(`${missing} tile${missing === 1 ? " is" : "s are"} not available from the provider here`)
		if (other > 0) parts.push(`${other} tile${other === 1 ? "" : "s"} failed to load`)
		notes[id] = parts.join("; ")
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
/** Land control tile fetched once per source: z3 x5 y3 spans 45-90E, 0-41N (Arabian Sea, Pakistan, India: mostly land with coastline and relief). */
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
	private controlFailedFlag = false
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
		return !this.decided && !this.controlFailedFlag && this.control === undefined && this.dominant() !== undefined
	}

	/** The control tile could not be fetched or hashed. Without it nothing is claimed: fail safe, stop sampling. */
	markControlFailed(): void {
		this.controlFailedFlag = true
		this.decided = true
	}

	controlFailed(): boolean {
		return this.controlFailedFlag
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
		this.controlFailedFlag = false
		this.decided = false
	}
}

/** Time allowed for the control tile request. */
export const CONTROL_TIMEOUT_MS = 10_000

export type ControlOutcome = "confirmed" | "cleared" | "failed"

/**
 * Runs the land-control check. `load(url, signal)` resolves to the tile's fingerprint and rejects on any failure
 * (HTTP error, network, hashing). Any failure or the timeout marks the control failed on the tracker, so the
 * check is never retried and no placeholder is claimed (fail safe).
 */
export async function runControlCheck(options: {
	url: string
	tracker: TilePlaceholderTracker
	load: (url: string, signal: AbortSignal) => Promise<string>
	timeoutMs?: number
}): Promise<ControlOutcome> {
	const { url, tracker, load, timeoutMs = CONTROL_TIMEOUT_MS } = options
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)
	try {
		const fingerprint = await new Promise<string>((resolve, reject) => {
			controller.signal.addEventListener("abort", () => reject(new Error("Control tile request timed out")), { once: true })
			load(url, controller.signal).then(resolve, reject)
		})
		tracker.setControl(fingerprint)
		return tracker.suspected() ? "confirmed" : "cleared"
	} catch {
		tracker.markControlFailed()
		return "failed"
	} finally {
		clearTimeout(timer)
	}
}
