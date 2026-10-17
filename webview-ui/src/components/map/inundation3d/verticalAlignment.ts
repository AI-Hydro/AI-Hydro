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

/** Shift mesh Z (every third position) for orthometric → ellipsoid alignment. */
export function applyMeshVerticalOffset(mesh: Inundation3DMesh, offsetM: number): Inundation3DMesh {
	if (!Number.isFinite(offsetM) || offsetM === 0) {
		return mesh
	}
	const positions = normalizeNumberArray(mesh.positions)
	if (positions.length === 0) {
		return mesh
	}
	const shifted = positions.map((value, index) => (index % 3 === 2 ? value + offsetM : value))
	return { ...mesh, positions: shifted }
}

export function terrainOffsetForManifest(manifest: { terrain_vertical_offset_m?: number; mesh_vertical_datum?: string }): number {
	if (!manifest.mesh_vertical_datum?.startsWith("orthometric")) {
		return 0
	}
	const offset = manifest.terrain_vertical_offset_m
	return Number.isFinite(offset) ? Number(offset) : 0
}
