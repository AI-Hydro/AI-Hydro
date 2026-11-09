/**
 * Where the river layer's data comes from, and what each source requires us to say. Plain constants (no heavy
 * imports) so the basemap catalogue can reference them without pulling in the PMTiles and MVT decoders.
 */

/** GEOGLOWS v2 global stream network: CC BY 4.0, ~2.39 GB, MVT, gzip, z0-z12; attributes `riverId` and `strahlerOrder` only. */
export const GEOGLOWS_STREAMS_URL = "https://geoglows-v2.s3.us-west-2.amazonaws.com/hydrography-global/streams.pmtiles"
/** Zoom range of the archive (header probed 2026-11-08). */
export const GEOGLOWS_MIN_ZOOM = 0
export const GEOGLOWS_MAX_ZOOM = 12
/** Credit line the licence asks for (https://geoglows.ecmwf.int/license). */
export const GEOGLOWS_ATTRIBUTION = "Rivers: GEOGLOWS ECMWF Streamflow Service (CC BY 4.0)"
/** Bundled low-zoom and offline tier. */
export const NATURAL_EARTH_ATTRIBUTION = "Natural Earth (public domain)"

/** Layer name inside the archive (tippecanoe `--layer streams`). */
export const STREAMS_LAYER = "streams"

/** Id of the river tile source in tile-health tallies and in the loaded-overlay set. */
export const RIVER_TALLY_ID = "basemap-rivers"
/** Ids used with `attributionFor`'s loaded set. */
export const RIVER_SOURCE_ID = "rivers"
export const NATURAL_EARTH_SOURCE_ID = "natural-earth"
