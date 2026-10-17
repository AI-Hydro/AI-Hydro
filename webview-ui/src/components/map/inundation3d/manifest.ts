/**
 * Parse embedded inundation 3D manifest from map layer metadata.
 */

export interface Inundation3DMesh {
	positions: number[]
	indices: number[]
	vertex_count?: number
	triangle_count?: number
	bounds_wgs84?: [number, number, number, number] | null
}

export interface Inundation3DFrame {
	index: number
	mesh?: Inundation3DMesh
	time_start?: string
	time_end?: string
	time_hr?: number
	discharge_m3s?: number
	stage_m?: number
	hydrograph_frame?: number
}

export interface Inundation3DManifest {
	version?: number
	presentation_tier?: string
	caveat?: string
	bounds_wgs84?: [number, number, number, number]
	camera_path?: Array<{
		frame_index?: number
		longitude: number
		latitude: number
		pitch?: number
		bearing?: number
		zoom?: number
	}>
	camera_path_source?: string
	mesh_vertical_datum?: string
	terrain_vertical_datum?: string
	terrain_vertical_offset_m?: number
	terrain_vertical_note?: string
	frames?: Inundation3DFrame[]
}

export function parseInundation3DManifest(raw: string | undefined): Inundation3DManifest | null {
	if (!raw) {
		return null
	}
	try {
		const parsed = JSON.parse(raw) as Inundation3DManifest
		if (!Array.isArray(parsed?.frames) || parsed.frames.length === 0) {
			return null
		}
		return parsed
	} catch {
		return null
	}
}

export function findInundation3DManifestLayer(
	layers: Array<{ id: string; metadata?: Record<string, string> }>,
	manifestByLayerId?: ReadonlyMap<string, Inundation3DManifest>,
): { layerId: string; manifest: Inundation3DManifest } | null {
	for (const layer of layers) {
		const cached = manifestByLayerId?.get(layer.id)
		if (cached) {
			return { layerId: layer.id, manifest: cached }
		}
		const manifest = parseInundation3DManifest(layer.metadata?.inundation_3d_manifest_json)
		if (manifest) {
			return { layerId: layer.id, manifest }
		}
	}
	return null
}

export function meshForFrame(manifest: Inundation3DManifest, frameIndex: number): Inundation3DMesh | null {
	const frames = manifest.frames ?? []
	const frame = frames.find((f) => f.index === frameIndex) ?? frames[frameIndex]
	const mesh = frame?.mesh
	if (!mesh?.positions?.length || !mesh.indices?.length) {
		return null
	}
	return mesh
}

export function manifestFrameCount(manifest: Inundation3DManifest | null | undefined): number {
	return manifest?.frames?.length ?? 0
}

export function manifestBoundsWgs84(manifest: Inundation3DManifest | null | undefined): [number, number, number, number] | null {
	const b = manifest?.bounds_wgs84
	if (!b || b.length !== 4) {
		return null
	}
	return [b[0], b[1], b[2], b[3]]
}
