/**
 * The GEOGLOWS river archive as the screen harness answers it: a SYNTHETIC PMTiles archive (Natural Earth trunk
 * rivers plus seeded random-walk tributaries; see webview-ui/src/components/map/rivers/testing/pmtilesFixture.mjs)
 * served with HTTP range semantics. The real 2.39 GB file is never requested. Screens that draw it are fixtures.
 *
 * Fault screens (keyed by screen id, deterministic):
 *   map-rivers-offline   every request answers 503, as an unreachable provider would
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
	buildPmtiles,
	syntheticNetwork,
	tilesFromSegments,
} from "../../webview-ui/src/components/map/rivers/testing/pmtilesFixture.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const GEOGLOWS_HOST = "geoglows-v2.s3.us-west-2.amazonaws.com"
/** The fixture archive is populated to this zoom; deeper tiles are simply absent (empty), as ocean tiles are. */
export const FIXTURE_MAX_ZOOM = 9

let archive
const fixtureArchive = () => {
	if (!archive) {
		const naturalEarth = JSON.parse(
			readFileSync(resolve(here, "../../webview-ui/src/components/map/rivers/naturalEarthHydro.json"), "utf8"),
		)
		const tiles = tilesFromSegments(syntheticNetwork(naturalEarth), { minZoom: 0, maxZoom: FIXTURE_MAX_ZOOM })
		archive = buildPmtiles(tiles, { minZoom: 0, maxZoom: FIXTURE_MAX_ZOOM, gzip: true })
	}
	return archive
}

export const isRiverArchiveRequest = (url) => {
	try {
		const u = new URL(url)
		return u.host === GEOGLOWS_HOST && u.pathname.endsWith(".pmtiles")
	} catch {
		return false
	}
}

const FAULTS = { "map-rivers-offline": 503 }

/** @returns {{ status: number, headers: Record<string, string>, body: Buffer | string }} */
export function riverArchiveResponse(screenId, rangeHeader) {
	if (FAULTS[screenId])
		return { status: FAULTS[screenId], headers: {}, body: "injected river archive fault (UI screen harness)" }
	const file = fixtureArchive()
	const m = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader ?? "")
	if (!m) return { status: 200, headers: { "content-length": String(file.length), etag: '"fixture"' }, body: Buffer.from(file) }
	const start = Number(m[1])
	const end = Math.min(file.length - 1, Number(m[2]))
	return {
		status: 206,
		headers: { "content-range": `bytes ${start}-${end}/${file.length}`, etag: '"fixture"' },
		body: Buffer.from(file.subarray(start, end + 1)),
	}
}
