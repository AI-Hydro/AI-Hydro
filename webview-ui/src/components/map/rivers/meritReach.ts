/**
 * The click-to-inspect card for a local MERIT-Basins reach: the tile attributes, and the provenance of the file they came
 * from. Pure functions; `MapView` turns a pick into a `ClickedFeature` with `meritReachFeature`.
 *
 * A reach with no recorded upstream area says "not recorded", never 0. The hidden (`_`) keys carry the machine-readable
 * citation object an agent hand-off or a claim binding would use: `{dataset, region, comid, source_sha256, tiles_sha256, licence}`.
 */
import type { MeritArchiveOffer } from "@shared/map/meritTileContract"
import { MERIT_LAYER_PREFIX } from "@shared/map/meritTileContract"
import type { MeritSegment } from "./meritRivers"

export const NOT_RECORDED = "not recorded"

/** Upstream area to 4 significant figures, in km2 (the raw value is in the hidden `_uparea_km2` key). */
export function formatUpareaKm2(uparea: number | null): string {
	if (uparea === null || !Number.isFinite(uparea)) return NOT_RECORDED
	return `${Number(uparea.toPrecision(4)).toLocaleString("en-US", { maximumFractionDigits: 3 })} km²`
}

const orNotRecorded = (value: number | null, unit = ""): string => (value === null ? NOT_RECORDED : `${value}${unit}`)

const VERIFICATION_TEXT: Record<string, string> = {
	"sha256-verified": "sha256-verified (the tile file's sha256 matches its record)",
	"size-matched": "size-matched (sha256 check pending)",
}

export interface MeritReachFeature {
	layerId: string
	layerName: string
	properties: Record<string, unknown>
	geometry: { type: "LineString"; coordinates: [number, number][] }
}

export function meritReachFeature(segment: MeritSegment, offer: MeritArchiveOffer | undefined): MeritReachFeature {
	const p = offer?.provenance
	const properties: Record<string, unknown> = {
		COMID: String(segment.comid),
		"Upstream area": formatUpareaKm2(segment.uparea),
		"Strahler order": orNotRecorded(segment.sorder),
		Length: orNotRecorded(segment.lengthkm, " km"),
		Region: offer?.region ?? segment.archiveId.replace(/^rivers/, ""),
		"Source db": p?.sourceName ?? NOT_RECORDED,
		"Source sha256": p?.sourceSha256 ?? NOT_RECORDED,
		Tiles: p?.tilesName ?? `${segment.archiveId}.pmtiles`,
		"Tiles sha256": p?.tilesSha256 ?? NOT_RECORDED,
		Verified: p ? (VERIFICATION_TEXT[p.verification] ?? p.verification) : "no provenance record",
		Licence: p?.attribution ?? NOT_RECORDED,
		...(p?.licenceNote ? { "Licence note": p.licenceNote } : {}),
		...(p?.sourcePinned ? { "Source pinned": p.sourcePinned } : {}),
		...(p?.verifiedAt ? { "Source verified": p.verifiedAt } : {}),
		...(p?.reachesDropped !== undefined ? { "Reaches dropped at z12": String(p.reachesDropped) } : {}),
		Citation: p?.citationDetail || p?.citation || NOT_RECORDED,
		_dataset: "MERIT-Basins",
		_uparea_km2: segment.uparea,
		_archive_id: segment.archiveId,
		_source_sha256: p?.sourceSha256,
		_tiles_sha256: p?.tilesSha256,
	}
	return {
		layerId: `${MERIT_LAYER_PREFIX}reach-${segment.comid}`,
		layerName: "MERIT-Basins river reach",
		properties,
		geometry: { type: "LineString", coordinates: segment.path },
	}
}

/** True for a deck layer id the MERIT tier drew. */
export const isMeritLayerId = (id: unknown): boolean => typeof id === "string" && id.startsWith(MERIT_LAYER_PREFIX)
