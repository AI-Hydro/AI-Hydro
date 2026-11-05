import * as fs from "fs/promises"
import { isValidGeoJSONString } from "./GeoJsonValidator"

/**
 * Decides from the first few kilobytes of a file whether it is map data, so listing a project never reads whole files.
 *
 * Scanning used to read every `.json` in full and parse it. With thousands of files that is minutes of work and
 * gigabytes of reads before the panel shows a row. A prefix of {@link SNIFF_BYTES} is enough for the question the list
 * asks ("is this GeoJSON?"); the real parse happens when a file is loaded, and a file that fails it says so then.
 */

export const SNIFF_BYTES = 8_192

const GEOJSON_TYPE =
	/"type"\s*:\s*"(?:FeatureCollection|Feature|Point|MultiPoint|LineString|MultiLineString|Polygon|MultiPolygon|GeometryCollection)"/

/**
 * `prefix` is the start of the file (at most SNIFF_BYTES) and `size` its full size.
 *  - A file that fits in the prefix is validated whole, as before.
 *  - `.geojson` and `.topojson` are trusted by their name once the text opens like a JSON object.
 *  - `.json` must show a GeoJSON `type` in the prefix: most `.json` files are not map data.
 */
export function looksLikeGeoJson(prefix: string, size: number, extension: string): boolean {
	const text = prefix.replace(/^﻿/, "").trimStart()
	if (!text.startsWith("{")) return false
	if (size <= SNIFF_BYTES) return isValidGeoJSONString(text).valid
	const ext = extension.toLowerCase()
	if (ext === ".geojson" || ext === ".topojson") return true
	return GEOJSON_TYPE.test(text)
}

/** Reads at most SNIFF_BYTES from the start of a file. */
export async function readPrefix(filePath: string): Promise<string> {
	const handle = await fs.open(filePath, "r")
	try {
		const buffer = Buffer.alloc(SNIFF_BYTES)
		const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0)
		return buffer.subarray(0, bytesRead).toString("utf8")
	} finally {
		await handle.close()
	}
}
