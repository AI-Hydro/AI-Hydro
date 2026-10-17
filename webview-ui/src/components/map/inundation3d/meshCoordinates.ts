import type { Inundation3DMesh } from "./manifest"

function normalizeNumberArray(value: unknown): number[] {
	if (Array.isArray(value)) {
		return value.map((v) => Number(v)).filter((v) => Number.isFinite(v))
	}
	if (value != null && typeof value === "object") {
		const record = value as Record<string, unknown>
		const keys = Object.keys(record)
			.filter((k) => /^\d+$/.test(k))
			.sort((a, b) => Number(a) - Number(b))
		if (keys.length > 0) {
			return keys.map((k) => Number(record[k])).filter((v) => Number.isFinite(v))
		}
	}
	return []
}

/**
 * deck.gl SimpleMeshLayer expects vertex positions as meter offsets in a local
 * ENU frame anchored at coordinateOrigin — not absolute [lon, lat, z].
 */
export function meshAnchorAndLocalPositions(mesh: Inundation3DMesh): {
	anchor: [number, number, number]
	positions: Float32Array
} {
	const src = normalizeNumberArray(mesh.positions)
	if (src.length < 3) {
		return { anchor: [0, 0, 0], positions: new Float32Array(0) }
	}

	let minLon = Infinity
	let maxLon = -Infinity
	let minLat = Infinity
	let maxLat = -Infinity
	let minZ = Infinity
	let maxZ = -Infinity

	for (let i = 0; i < src.length; i += 3) {
		minLon = Math.min(minLon, src[i])
		maxLon = Math.max(maxLon, src[i])
		minLat = Math.min(minLat, src[i + 1])
		maxLat = Math.max(maxLat, src[i + 1])
		minZ = Math.min(minZ, src[i + 2])
		maxZ = Math.max(maxZ, src[i + 2])
	}

	const anchorLon = (minLon + maxLon) / 2
	const anchorLat = (minLat + maxLat) / 2
	const anchorZ = (minZ + maxZ) / 2

	const latRad = (anchorLat * Math.PI) / 180
	const metersPerDegLon = 111320 * Math.cos(latRad)
	const metersPerDegLat = 110540

	const out = new Float32Array(src.length)
	for (let i = 0; i < src.length; i += 3) {
		out[i] = (src[i] - anchorLon) * metersPerDegLon
		out[i + 1] = (src[i + 1] - anchorLat) * metersPerDegLat
		out[i + 2] = src[i + 2] - anchorZ
	}

	return { anchor: [anchorLon, anchorLat, anchorZ], positions: out }
}

export function meshIndexArray(mesh: Inundation3DMesh): Uint32Array {
	return new Uint32Array(normalizeNumberArray(mesh.indices))
}

export function meshTriangleCount(mesh: Inundation3DMesh | null | undefined): number {
	const indices = normalizeNumberArray(mesh?.indices)
	if (!indices.length) {
		return 0
	}
	return Math.floor(indices.length / 3)
}
