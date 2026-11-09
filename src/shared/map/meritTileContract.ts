/**
 * The contract between the MERIT-Basins river tile builder (aihydro-watershed `tiles/merit_rivers.py`), the extension
 * host (archive registry and byte-range reads) and the map webview (decoding and drawing).
 *
 * ONE place for every name the three sides must agree on: the layer names, the attribute names, the sidecar keys, the
 * file naming, the message types and the limits. If the tile format changes in review, only this file changes.
 * Pure data and pure functions (no Node, no DOM), so the host and the webview both import it.
 *
 * Design: docs/vision-2040/findings/b2-local-pmtiles-serving-2026-11-09.md (transport (b), registry, card, credit) and
 * hydrology-basemap-2026-11-08.md section 3 (zone rule Z1, width rule W1).
 */

/** `tile_schema_version` of the sidecar this build understands. */
export const MERIT_TILE_SCHEMA_VERSION = 2

/** The five MVT layers, finest-last. Each is one Z1 upstream-area band; a tile carries the layers its zoom reaches. */
export const MERIT_LAYER_NAMES = ["rivers_z0", "rivers_z5", "rivers_z7", "rivers_z9", "rivers_z11"] as const
export type MeritLayerName = (typeof MERIT_LAYER_NAMES)[number]

/** Feature attributes in the tiles. */
export const MERIT_ATTR = { comid: "comid", uparea: "uparea", sorder: "sorder", lengthkm: "lengthkm" } as const

/** `rivers72.pmtiles` (two-digit Pfafstetter region). The sidecar is the same name plus `.provenance.json`. */
export const MERIT_ARCHIVE_FILE_RE = /^rivers(\d{2})\.pmtiles$/
export const MERIT_SIDECAR_SUFFIX = ".provenance.json"
/** Directory below the MERIT data root that holds the archives. */
export const MERIT_TILES_SUBDIR = "tiles"
/** Environment variables the builder honours, in its order (`merit_rivers.merit_root`). Fallback: `<AIHYDRO_HOME>/merit`. */
export const MERIT_ROOT_ENV_VARS = ["AIHYDRO_MERIT_DIR", "MERIT_DATA_DIR"] as const

/** The licence words an archive's credit line must contain, or it is not offered (CC BY-NC-SA is share-alike and non-commercial). */
export const MERIT_REQUIRED_LICENCE_WORDS = "CC BY-NC-SA"
export const MERIT_SOURCE_ID = "merit-rivers"
/** Prefix of every deck layer id the MERIT tier draws; the click handler routes picks by it. */
export const MERIT_LAYER_PREFIX = "merit-rivers-"

/** Largest read the host serves in one reply. */
export const MERIT_MAX_RANGE_BYTES = 8 * 1024 * 1024
/** The first read of a PMTiles archive asks for 16 KiB even when the file is smaller; reads may run this far past the end. */
export const MERIT_RANGE_OVERSHOOT = 16384

export const MERIT_MSG = {
	archivesRequest: "aihydro-merit-archives-request",
	archives: "aihydro-merit-archives",
	range: "aihydro-tile-range",
	rangeResult: "aihydro-tile-range-result",
} as const

/**
 * Sidecar keys of the merged builder (aihydro-watershed `tiles/merit_rivers.py`, schema 2). `licence_note` says the exact
 * MERIT licence variant is unresolved. `source_pinned`, `verified_at` and `sha256_origin` sit under `source`.
 * `reaches_absent_at_max_zoom` (an integer) counts reaches not drawn at max zoom (degenerate, sub-pixel);
 * `reaches_absent_at_max_zoom_comids` lists them, capped at 100 (the count is exact). All are tolerated when absent.
 */
export const MERIT_SIDECAR_KEYS = {
	licenceNote: "licence_note",
	sourcePinned: "source_pinned",
	verifiedAt: "verified_at",
	sha256Origin: "sha256_origin",
	reachesAbsent: "reaches_absent_at_max_zoom",
	reachesAbsentComids: "reaches_absent_at_max_zoom_comids",
} as const

/** The three values of `source.sha256_origin` the builder writes. */
export const MERIT_SHA256_ORIGINS = [
	"staging_provenance_sidecar_verified_against_pin",
	"staging_provenance_sidecar_unverified",
	"computed_no_sidecar",
] as const

/**
 * What the host checked. "size-matched": the sidecar parsed and the size matches, the sha256 check has not finished.
 * "sha256-check-failed": the check could not run (the file was unreadable); it is NOT a mismatch, which withdraws the archive.
 * The sidecar's sha256 proves consistency between the sidecar and the file, not authenticity: the sidecar is unsigned.
 */
export type MeritVerification = "size-matched" | "sha256-verified" | "sha256-check-failed"

/** One archive in an export manifest (`merit`). */
export interface MeritExportRecord {
	id: string
	region: string
	tiles_sha256: string
	source_sha256: string
	verification: MeritVerification
}

export function meritExportRecords(
	archives: ReadonlyArray<Pick<MeritArchiveOffer, "id" | "region" | "provenance">>,
): MeritExportRecord[] {
	return archives.map((a) => ({
		id: a.id,
		region: a.region,
		tiles_sha256: a.provenance.tilesSha256,
		source_sha256: a.provenance.sourceSha256,
		verification: a.provenance.verification,
	}))
}

/** What the host checked about an archive before offering it. The webview never reads the sidecar itself. */
export interface MeritProvenance {
	tileSchemaVersion: number
	region: string
	sourceName: string
	sourceSha256: string
	sourceSha256Origin: string
	tilesName: string
	tilesSha256: string
	tilesSizeBytes: number
	builtAt: string
	licence: string
	citation: string
	citationDetail: string
	attribution: string
	/** Absent in older sidecars. */
	licenceNote?: string
	sourcePinned?: string
	verifiedAt?: string
	/** Reaches not drawn at max zoom (degenerate, sub-pixel), when the sidecar counts them. */
	reachesAbsent?: number
	reachesAbsentComids?: number[]
	verification: MeritVerification
}

export interface MeritArchiveOffer {
	/** File stem, `rivers72`. The only handle the webview has; the host maps it to a path. */
	id: string
	region: string
	minZoom: number
	maxZoom: number
	/** [west, south, east, north] from the PMTiles header. */
	bounds: [number, number, number, number]
	layers: string[]
	provenance: MeritProvenance
}

export interface MeritArchivesMessage {
	type: typeof MERIT_MSG.archives
	archives: MeritArchiveOffer[]
	/** Archives that were found and not offered, with the reason (a missing or invalid record, a hash mismatch). */
	notes: string[]
}

export interface MeritRangeRequest {
	type: typeof MERIT_MSG.range
	requestId: string
	archiveId: string
	offset: number
	length: number
}

export interface MeritRangeResult {
	type: typeof MERIT_MSG.rangeResult
	requestId: string
	ok: boolean
	data?: ArrayBuffer
	etag?: string
	error?: string
}

/** The words a missing record is reported with (the map shows this note). */
export function meritInvalidProvenanceNote(region: string, reason: string): string {
	return `Local MERIT tiles for region ${region} have no valid provenance record (${reason}); rebuild them.`
}

export const MERIT_ARCHIVE_ID_RE = /^rivers\d{2}$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)
const str = (value: unknown): string => (typeof value === "string" ? value : "")

export type SidecarCheck = { ok: true; provenance: Omit<MeritProvenance, "verification"> } | { ok: false; reason: string }

/**
 * Validates a parsed sidecar against the file it describes. The archive is offered only when the record parses, has
 * the schema version this build knows, names this file, states this file's size, carries both sha256 values and a
 * credit line that contains the NC-SA words (so the credit shown can never be weaker than the licence).
 */
export function checkSidecar(raw: unknown, file: { name: string; sizeBytes: number }): SidecarCheck {
	if (!isRecord(raw)) return { ok: false, reason: "not a JSON object" }
	if (raw.tile_schema_version !== MERIT_TILE_SCHEMA_VERSION)
		return { ok: false, reason: `tile_schema_version ${String(raw.tile_schema_version)} is not ${MERIT_TILE_SCHEMA_VERSION}` }
	const source = isRecord(raw.source) ? raw.source : {}
	const output = isRecord(raw.output) ? raw.output : {}
	if (output.name !== file.name) return { ok: false, reason: "output.name does not match the file" }
	if (output.size_bytes !== file.sizeBytes) return { ok: false, reason: "output.size_bytes does not match the file size" }
	const sha = /^[0-9a-f]{64}$/
	if (!sha.test(str(output.sha256))) return { ok: false, reason: "output.sha256 missing" }
	if (!sha.test(str(source.sha256))) return { ok: false, reason: "source.sha256 missing" }
	const attribution = str(raw.attribution)
	if (!attribution.includes(MERIT_REQUIRED_LICENCE_WORDS))
		return { ok: false, reason: `attribution lacks "${MERIT_REQUIRED_LICENCE_WORDS}"` }
	const optional = (k: string): string | undefined => {
		const v = source[k] ?? raw[k]
		return typeof v === "string" ? v : typeof v === "boolean" || typeof v === "number" ? String(v) : undefined
	}
	const absent = raw[MERIT_SIDECAR_KEYS.reachesAbsent]
	const absentComids = raw[MERIT_SIDECAR_KEYS.reachesAbsentComids]
	const region = str(raw.region)
	if (!/^\d{1,2}$/.test(region)) return { ok: false, reason: "region missing" }
	return {
		ok: true,
		provenance: {
			tileSchemaVersion: MERIT_TILE_SCHEMA_VERSION,
			region,
			sourceName: str(source.name),
			sourceSha256: str(source.sha256),
			sourceSha256Origin: str(source[MERIT_SIDECAR_KEYS.sha256Origin]),
			tilesName: file.name,
			tilesSha256: str(output.sha256),
			tilesSizeBytes: file.sizeBytes,
			builtAt: str(raw.built_at),
			licence: str(raw.licence),
			citation: str(raw.citation),
			citationDetail: str(raw.citation_detail),
			attribution,
			licenceNote: optional(MERIT_SIDECAR_KEYS.licenceNote),
			sourcePinned: optional(MERIT_SIDECAR_KEYS.sourcePinned),
			verifiedAt: optional(MERIT_SIDECAR_KEYS.verifiedAt),
			reachesAbsent: typeof absent === "number" && Number.isInteger(absent) ? absent : undefined,
			reachesAbsentComids: Array.isArray(absentComids)
				? absentComids.filter((c): c is number => typeof c === "number")
				: undefined,
		},
	}
}

/**
 * Why a read request is refused, or undefined when it is allowed. Integers only; 1 byte to 8 MiB; the start must lie
 * inside the file (a read may run up to the PMTiles initial-read overshoot past the end and is then short).
 */
export function checkRangeRequest(offset: unknown, length: unknown, fileSize: number): string | undefined {
	if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) return "offset must be a non-negative integer"
	if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 1) return "length must be a positive integer"
	if (length > MERIT_MAX_RANGE_BYTES) return `length is over the ${MERIT_MAX_RANGE_BYTES} byte limit`
	if (offset >= fileSize) return "offset is past the end of the archive"
	if (offset + length > fileSize + MERIT_RANGE_OVERSHOOT) return "range runs past the end of the archive"
	return undefined
}
