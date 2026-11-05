/**
 * Project files: the rules the host and the Layers panel share.
 *
 * Every map file of the open folders appears once: on the map as its layer row, or under "Not on the map". Load moves
 * the row up and Unload moves it down. "Remove from list" hides a row on this machine and never touches the file.
 */

/** Files the scan lists at most. The scan asks for one more, so it can say `5,000+` and mean it. */
export const MAX_PROJECT_FILES = 5_000

/**
 * A load above this many bytes asks first. 20 MB is the largest layer the map already keeps across a restart
 * (`MAX_GEOJSON_CACHE_BYTES_TOOL`). Above it the extension host reads the whole file into memory before it builds a
 * preview (previews start at 4 MB), which can freeze the window for several seconds.
 */
export const LARGE_LOAD_BYTES = 20_000_000

/** Directories at the top of an open folder that the scan never enters, besides `files.exclude`. `.aihydro` holds the tools' own output. */
export const AIHYDRO_STATE_DIR = ".aihydro"

/** Extensions the scan lists. `tif`, `tiff` and `kmz` are unambiguous map data; `csv` and `zip` are not and stay behind Add file. */
export const PROJECT_FILE_EXTENSIONS = [
	"geojson",
	"json",
	"kml",
	"kmz",
	"gpx",
	"topojson",
	"topo.json",
	"fgb",
	"shp",
	"tif",
	"tiff",
] as const

/** "12.4 MB", "820 KB", "96 B". Decimal units, one decimal above 1 MB, none below. */
export function formatBytes(bytes: number | undefined): string {
	if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return ""
	if (bytes < 1_000) return `${Math.round(bytes)} B`
	if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`
	if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`
	return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}

/** `1,234` for a count, `5,000+` when the scan stopped at its limit. */
export function formatCount(count: number, truncated: boolean): string {
	return `${count.toLocaleString("en-US")}${truncated ? "+" : ""}`
}

/** The header of the lower section: `Not on the map · 3 files`. Counts the files not on the map; `+` when the scan stopped at its limit. */
export function notOnMapHeader(count: number, truncated: boolean): string {
	return `Not on the map · ${formatCount(count, truncated)} file${count === 1 && !truncated ? "" : "s"}`
}

export function isLargeLoad(sizeBytes: number | undefined): boolean {
	return sizeBytes !== undefined && sizeBytes > LARGE_LOAD_BYTES
}
