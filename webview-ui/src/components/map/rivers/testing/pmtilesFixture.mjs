/**
 * Test and screen-harness fixtures for the river layer: a minimal MVT encoder, a PMTiles v3 writer, and a
 * SYNTHETIC river network built from the bundled Natural Earth rivers. Nothing here ships in the extension; it is
 * imported by vitest and by scripts/ui-screens/run.mjs, so both read exactly the same bytes and no network is used.
 *
 * The synthetic network is NOT GEOGLOWS data: the trunk rivers are Natural Earth (public domain) with Strahler
 * orders taken from their scalerank, and the tributaries are drawn by a seeded random walk. Screens that use it
 * are stamped FIXTURE by the harness. Its only job is to exercise the reader, the styling and the zoom bands.
 */
import { gzipSync } from "node:zlib"

// ── Protobuf / MVT encoding ──────────────────────────────────────────────────────────────────────────────────
const varint = (n) => {
	const out = []
	let v = n >>> 0
	while (v > 0x7f) {
		out.push((v & 0x7f) | 0x80)
		v >>>= 7
	}
	out.push(v)
	return out
}
const zigzag = (n) => ((n << 1) ^ (n >> 31)) >>> 0
const field = (num, wire, bytes) => [...varint((num << 3) | wire), ...bytes]
const lenField = (num, bytes) => field(num, 2, [...varint(bytes.length), ...bytes])
const text = (s) => [...new TextEncoder().encode(s)]

/** lon/lat to tile pixel coordinates at tile (z, x, y) on an `extent` grid (float). */
export function lonLatToTilePixel(lon, lat, z, x, y, extent = 4096) {
	const n = 2 ** z
	const sin = Math.sin((lat * Math.PI) / 180)
	const fx = ((lon + 180) / 360) * n
	const fy = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n
	return [(fx - x) * extent, (fy - y) * extent]
}

/**
 * Encodes one MVT layer of LineString features.
 * @param {string} layerName
 * @param {{ props: Record<string, number>, lines: [number, number][][] }[]} features  lines in tile pixels (integers)
 */
export function encodeMvtLayer(layerName, features, extent = 4096) {
	const keys = []
	const values = []
	const featureBytes = []
	for (const feature of features) {
		const tags = []
		for (const [k, v] of Object.entries(feature.props)) {
			let ki = keys.indexOf(k)
			if (ki < 0) ki = keys.push(k) - 1
			let vi = values.indexOf(v)
			if (vi < 0) vi = values.push(v) - 1
			tags.push(ki, vi)
		}
		const geometry = []
		let cx = 0
		let cy = 0
		for (const line of feature.lines) {
			if (line.length < 2) continue
			geometry.push(...varint((1 << 3) | 1)) // MoveTo x1
			geometry.push(...varint(zigzag(line[0][0] - cx)), ...varint(zigzag(line[0][1] - cy)))
			cx = line[0][0]
			cy = line[0][1]
			geometry.push(...varint(((line.length - 1) << 3) | 2)) // LineTo xN
			for (let i = 1; i < line.length; i++) {
				geometry.push(...varint(zigzag(line[i][0] - cx)), ...varint(zigzag(line[i][1] - cy)))
				cx = line[i][0]
				cy = line[i][1]
			}
		}
		if (geometry.length === 0) continue
		featureBytes.push(
			...lenField(2, [
				...lenField(
					2,
					tags.flatMap((t) => varint(t)),
				),
				...field(3, 0, varint(2)), // type LINESTRING
				...lenField(4, geometry),
			]),
		)
	}
	const layer = [
		...field(15, 0, varint(2)), // version
		...lenField(1, text(layerName)),
		...featureBytes,
		...keys.flatMap((k) => lenField(3, text(k))),
		...values.flatMap((v) => lenField(4, field(5, 0, varint(v)))), // uint_value
		...field(5, 0, varint(extent)),
	]
	return Uint8Array.from(lenField(3, layer))
}

// ── PMTiles v3 ───────────────────────────────────────────────────────────────────────────────────────────────
function rotate(n, xy, rx, ry) {
	if (ry === 0) {
		if (rx === 1) {
			xy[0] = n - 1 - xy[0]
			xy[1] = n - 1 - xy[1]
		}
		const t = xy[0]
		xy[0] = xy[1]
		xy[1] = t
	}
}

/** Hilbert-curve tile id of (z, x, y), as the PMTiles v3 spec defines it. */
export function tileIdOf(z, x, y) {
	let acc = 0
	for (let t = 0; t < z; t++) acc += 2 ** t * 2 ** t
	const n = 2 ** z
	let d = 0
	const xy = [x, y]
	for (let s = n / 2; s > 0; s /= 2) {
		const rx = (xy[0] & s) > 0 ? 1 : 0
		const ry = (xy[1] & s) > 0 ? 1 : 0
		d += s * s * ((3 * rx) ^ ry)
		rotate(s, xy, rx, ry)
	}
	return acc + d
}

const u64 = (view, off, n) => view.setBigUint64(off, BigInt(n), true)

/**
 * Writes a PMTiles v3 archive holding MVT tiles.
 * @param {Map<string, Uint8Array>} tiles  key "z/x/y" -> tile bytes (uncompressed MVT)
 * @param {{ minZoom?: number, maxZoom?: number, bounds?: [number, number, number, number], gzip?: boolean, metadata?: object }} [options]
 *   `gzip`: compress tiles and the directory, as the GEOGLOWS archive does.
 */
export function buildPmtiles(tiles, options = {}) {
	const entries = [...tiles.entries()]
		.map(([key, bytes]) => {
			const [z, x, y] = key.split("/").map(Number)
			return { id: tileIdOf(z, x, y), z, bytes: options.gzip ? gzipSync(bytes) : bytes }
		})
		.sort((a, b) => a.id - b.id)
	const zooms = entries.map((e) => e.z)
	const pack = (bytes) => (options.gzip ? gzipSync(Uint8Array.from(bytes)) : Uint8Array.from(bytes))
	/** Serialises directory entries { id, runLength, length, offset } (offset 0 is encoded as offset+1 for the first, 0 when contiguous). */
	const serialize = (list) => {
		const out = [...varint(list.length)]
		let last = 0
		for (const e of list) {
			out.push(...varint(e.id - last))
			last = e.id
		}
		for (const e of list) out.push(...varint(e.runLength))
		for (const e of list) out.push(...varint(e.length))
		let end = -1
		for (const e of list) {
			out.push(...varint(e.offset === end ? 0 : e.offset + 1))
			end = e.offset + e.length
		}
		return out
	}
	let offset = 0
	const tileEntries = entries.map((e) => {
		const entry = { id: e.id, runLength: 1, length: e.bytes.length, offset }
		offset += e.bytes.length
		return entry
	})
	// The spec keeps the root directory within the first 16 KiB, so a large archive splits tiles into leaf directories.
	const LEAF = 400
	let directory
	let leaves = new Uint8Array(0)
	if (tileEntries.length <= LEAF * 2) {
		directory = pack(serialize(tileEntries))
	} else {
		const leafBlobs = []
		for (let i = 0; i < tileEntries.length; i += LEAF)
			leafBlobs.push({ first: tileEntries[i].id, bytes: pack(serialize(tileEntries.slice(i, i + LEAF))) })
		leaves = new Uint8Array(leafBlobs.reduce((n, l) => n + l.bytes.length, 0))
		let at = 0
		const rootEntries = leafBlobs.map((l) => {
			leaves.set(l.bytes, at)
			const entry = { id: l.first, runLength: 0, length: l.bytes.length, offset: at }
			at += l.bytes.length
			return entry
		})
		directory = pack(serialize(rootEntries))
	}
	const metadata = new TextEncoder().encode(JSON.stringify(options.metadata ?? { name: "river fixture (synthetic)" }))
	const metaBytes = options.gzip ? gzipSync(metadata) : metadata
	const tileData = new Uint8Array(entries.reduce((n, e) => n + e.bytes.length, 0))
	let at = 0
	for (const e of entries) {
		tileData.set(e.bytes, at)
		at += e.bytes.length
	}
	const rootOffset = 127
	const metaOffset = rootOffset + directory.length
	const leafOffset = metaOffset + metaBytes.length
	const tileOffset = leafOffset + leaves.length
	const out = new Uint8Array(tileOffset + tileData.length)
	const view = new DataView(out.buffer)
	out.set(text("PMTiles"), 0)
	out[7] = 3
	u64(view, 8, rootOffset)
	u64(view, 16, directory.length)
	u64(view, 24, metaOffset)
	u64(view, 32, metaBytes.length)
	u64(view, 40, leafOffset)
	u64(view, 48, leaves.length)
	u64(view, 56, tileOffset)
	u64(view, 64, tileData.length)
	u64(view, 72, entries.length)
	u64(view, 80, entries.length)
	u64(view, 88, entries.length)
	out[96] = 1 // clustered
	out[97] = options.gzip ? 2 : 1 // internal compression
	out[98] = options.gzip ? 2 : 1 // tile compression
	out[99] = 1 // MVT
	out[100] = options.minZoom ?? Math.min(...zooms)
	out[101] = options.maxZoom ?? Math.max(...zooms)
	const [w, s, e, n] = options.bounds ?? [-180, -85, 180, 85]
	view.setInt32(102, Math.round(w * 1e7), true)
	view.setInt32(106, Math.round(s * 1e7), true)
	view.setInt32(110, Math.round(e * 1e7), true)
	view.setInt32(114, Math.round(n * 1e7), true)
	out[118] = out[100]
	view.setInt32(119, 0, true)
	view.setInt32(123, 0, true)
	out.set(directory, rootOffset)
	out.set(metaBytes, metaOffset)
	out.set(leaves, leafOffset)
	out.set(tileData, tileOffset)
	return out
}

// ── Synthetic river network ──────────────────────────────────────────────────────────────────────────────────
function mulberry32(seed) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/**
 * Trunk rivers from Natural Earth plus seeded tributaries. Returns segments `{ order, riverId, path: [lon, lat][] }`.
 * @param {{ rivers: [number, number[]][] }} naturalEarth  the bundled JSON
 * @param {{ seed?: number, branchBox?: [number, number, number, number] }} [options]
 *   `branchBox`: tributaries are grown only inside this lon/lat box (keeps the fixture small).
 */
export function syntheticNetwork(naturalEarth, options = {}) {
	const rand = mulberry32(options.seed ?? 20261109)
	const [w, s, e, n] = options.branchBox ?? [-130, 24, -60, 55]
	const out = []
	let id = 1
	const grow = (path, order, depth) => {
		out.push({ order, riverId: id++, path })
		if (order <= 1 || depth > 4) return
		for (let i = 2; i < path.length - 1; i += order >= 5 ? 1 : 2) {
			if (rand() > (order >= 7 ? 0.22 : order >= 5 ? 0.9 : 0.7)) continue
			const [x, y] = path[i]
			if (x < w || x > e || y < s || y > n) continue
			const dx = path[i + 1][0] - path[i - 1][0]
			const dy = path[i + 1][1] - path[i - 1][1]
			const len = Math.hypot(dx, dy) || 1
			const side = rand() < 0.5 ? -1 : 1
			const nx = (-dy / len) * side
			const ny = (dx / len) * side
			const steps = 3 + Math.floor(rand() * 4)
			const step = 0.025 * order * (0.6 + rand() * 0.8)
			const branch = [[x, y]]
			let cx = x
			let cy = y
			let heading = Math.atan2(ny, nx)
			for (let k = 0; k < steps; k++) {
				heading += (rand() - 0.5) * 0.9
				cx += Math.cos(heading) * step
				cy += Math.sin(heading) * step
				branch.push([cx, cy])
			}
			// Big rivers have few big tributaries: orders drop faster from the trunk.
			grow(branch, order - (order >= 7 ? 2 : 1) - (rand() < 0.3 ? 1 : 0), depth + 1)
		}
	}
	for (const [rank, flat] of naturalEarth.rivers) {
		const path = []
		for (let i = 0; i + 1 < flat.length; i += 2) path.push([flat[i], flat[i + 1]])
		if (path.length >= 2) grow(path, Math.max(1, 10 - rank), 0)
	}
	return out
}

/** Minimum Strahler order the real archive keeps at a zoom (tippecanoe filter recorded in its metadata). */
export const archiveMinOrder = (z) => (z >= 8 ? 1 : z >= 6 ? 4 : 6)

const clipSegment = (p, q, lo, hi) => {
	// Liang-Barsky against the square [lo, hi]^2.
	let t0 = 0
	let t1 = 1
	const dx = q[0] - p[0]
	const dy = q[1] - p[1]
	for (const [pp, qq] of [
		[-dx, p[0] - lo],
		[dx, hi - p[0]],
		[-dy, p[1] - lo],
		[dy, hi - p[1]],
	]) {
		if (pp === 0) {
			if (qq < 0) return null
		} else {
			const r = qq / pp
			if (pp < 0) {
				if (r > t1) return null
				if (r > t0) t0 = r
			} else {
				if (r < t0) return null
				if (r < t1) t1 = r
			}
		}
	}
	return [
		[p[0] + t0 * dx, p[1] + t0 * dy],
		[p[0] + t1 * dx, p[1] + t1 * dy],
	]
}

/**
 * Tiles (key "z/x/y" -> MVT bytes) for zooms minZoom..maxZoom from segments, with the real archive's order filter.
 * @param {{ order: number, riverId: number, path: [number, number][] }[]} segments
 */
export function tilesFromSegments(
	segments,
	{ minZoom = 0, maxZoom = 8, extent = 4096, buffer = 64, orderFilter = archiveMinOrder } = {},
) {
	const tiles = new Map()
	for (let z = minZoom; z <= maxZoom; z++) {
		const perTile = new Map()
		const minOrder = orderFilter(z)
		const n = 2 ** z
		for (const seg of segments) {
			if (seg.order < minOrder) continue
			for (let i = 0; i + 1 < seg.path.length; i++) {
				const [a, b] = [seg.path[i], seg.path[i + 1]]
				const world = [a, b].map(([lon, lat]) => lonLatToTilePixel(lon, lat, 0, 0, 0, n * extent))
				const x0 = Math.max(0, Math.floor(Math.min(world[0][0], world[1][0]) / extent))
				const x1 = Math.min(n - 1, Math.floor(Math.max(world[0][0], world[1][0]) / extent))
				const y0 = Math.max(0, Math.floor(Math.min(world[0][1], world[1][1]) / extent))
				const y1 = Math.min(n - 1, Math.floor(Math.max(world[0][1], world[1][1]) / extent))
				for (let tx = x0; tx <= x1; tx++) {
					for (let ty = y0; ty <= y1; ty++) {
						const local = world.map(([wx, wy]) => [wx - tx * extent, wy - ty * extent])
						const clipped = clipSegment(local[0], local[1], -buffer, extent + buffer)
						if (!clipped) continue
						const key = `${z}/${tx}/${ty}`
						let byFeature = perTile.get(key)
						if (!byFeature) perTile.set(key, (byFeature = new Map()))
						let entry = byFeature.get(seg)
						if (!entry) byFeature.set(seg, (entry = { lines: [] }))
						const line = entry.lines[entry.lines.length - 1]
						const [c0, c1] = clipped.map(([px, py]) => [Math.round(px), Math.round(py)])
						if (line && line[line.length - 1][0] === c0[0] && line[line.length - 1][1] === c0[1]) line.push(c1)
						else entry.lines.push([c0, c1])
					}
				}
			}
		}
		for (const [key, byFeature] of perTile) {
			const features = []
			for (const [seg, entry] of byFeature) {
				features.push({ props: { riverId: seg.riverId, strahlerOrder: seg.order }, lines: entry.lines })
			}
			tiles.set(key, encodeMvtLayer("streams", features, extent))
		}
	}
	return tiles
}
