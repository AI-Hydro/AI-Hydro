/**
 * Deterministic 256px basemap tile fixtures. No network: every external image
 * request is answered with one of these, chosen by the basemap id the URL maps to.
 */
import { deflateSync } from "node:zlib"

const BASEMAP_PATTERNS = [
	[/USGSTopo/, "usgs-topo", [226, 222, 205]],
	[/USGSImageryOnly/, "usgs-imagery", [66, 82, 60]],
	[/USGSShadedReliefOnly/, "usgs-shaded-relief", [200, 198, 190]],
	[/World_Hillshade/, "esri-hillshade", [180, 180, 180]],
	[/World_Imagery/, "esri-imagery", [74, 90, 64]],
	[/World_Topo_Map/, "esri-topo", [232, 228, 214]],
	[/World_Ocean_Base/, "esri-ocean", [170, 205, 225]],
	[/light_all/, "carto-light", [236, 236, 236]],
	[/dark_all/, "carto-dark", [38, 38, 40]],
]

export function basemapIdForUrl(url) {
	for (const [re, id, color] of BASEMAP_PATTERNS) if (re.test(url)) return { id, color }
	let h = 0
	for (const ch of new URL(url).host) h = (h * 31 + ch.charCodeAt(0)) >>> 0
	return { id: `other-${h.toString(16)}`, color: [120 + (h % 80), 120 + ((h >> 8) % 80), 120 + ((h >> 16) % 80)] }
}

const crcTable = (() => {
	const t = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		t[n] = c >>> 0
	}
	return t
})()
const crc32 = (buf) => {
	let c = 0xffffffff
	for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
	const len = Buffer.alloc(4)
	len.writeUInt32BE(data.length)
	const body = Buffer.concat([Buffer.from(type), data])
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(crc32(body))
	return Buffer.concat([len, body, crc])
}

const cache = new Map()
export function tilePng(color) {
	const key = color.join(",")
	if (cache.has(key)) return cache.get(key)
	const size = 256
	const raw = Buffer.alloc((size * 3 + 1) * size)
	for (let y = 0; y < size; y++) {
		raw[y * (size * 3 + 1)] = 0
		for (let x = 0; x < size; x++) {
			const grid = x % 64 === 0 || y % 64 === 0
			const river = Math.abs(x - y * 0.6 - 40) < 2 // faint synthetic "river" so the tile reads as a map
			const shade = grid ? -14 : river ? -30 : 0
			const o = y * (size * 3 + 1) + 1 + x * 3
			raw[o] = Math.max(0, Math.min(255, color[0] + shade))
			raw[o + 1] = Math.max(0, Math.min(255, color[1] + shade + (river ? 20 : 0)))
			raw[o + 2] = Math.max(0, Math.min(255, color[2] + shade + (river ? 40 : 0)))
		}
	}
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(size, 0)
	ihdr.writeUInt32BE(size, 4)
	ihdr[8] = 8
	ihdr[9] = 2
	const png = Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	])
	cache.set(key, png)
	return png
}
