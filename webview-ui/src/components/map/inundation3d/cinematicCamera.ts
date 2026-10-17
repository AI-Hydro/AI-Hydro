import type { Inundation3DManifest } from "./manifest"
import { manifestBoundsWgs84 } from "./manifest"

export interface CameraKeyframe {
	frame_index?: number
	longitude: number
	latitude: number
	pitch?: number
	bearing?: number
	zoom?: number
}

function estimateZoomFromBounds(bounds: [number, number, number, number]): number {
	const [w, s, e, n] = bounds
	const lonDelta = Math.max(0.001, e - w)
	const latDelta = Math.max(0.001, n - s)
	const zoomX = Math.log2((800 * 360) / (lonDelta * 512))
	const zoomY = Math.log2((600 * 180) / (latDelta * 512))
	return Math.max(9, Math.min(14, Math.min(zoomX, zoomY)))
}

function fallbackCameraPath(bounds: [number, number, number, number], frameCount: number): CameraKeyframe[] {
	const [w, s, e, n] = bounds
	const count = Math.max(frameCount, 1)
	const eastWest = e - w >= n - s
	const bearing = eastWest ? 90 : 0
	const pitch = 52
	const zoom = estimateZoomFromBounds(bounds)
	const path: CameraKeyframe[] = []
	for (let i = 0; i < count; i++) {
		const t = count <= 1 ? 0.5 : i / (count - 1)
		if (eastWest) {
			path.push({
				frame_index: i,
				longitude: w + (e - w) * t,
				latitude: (s + n) / 2,
				pitch,
				bearing,
				zoom,
			})
		} else {
			path.push({
				frame_index: i,
				longitude: (w + e) / 2,
				latitude: s + (n - s) * t,
				pitch,
				bearing,
				zoom,
			})
		}
	}
	return path
}

export function resolveCameraPath(manifest: Inundation3DManifest, frameCount: number): CameraKeyframe[] {
	const embedded = manifest.camera_path
	if (embedded?.length) {
		return embedded.map((kf, i) => ({
			frame_index: kf.frame_index ?? i,
			longitude: Number(kf.longitude),
			latitude: Number(kf.latitude),
			pitch: kf.pitch !== undefined ? Number(kf.pitch) : 52,
			bearing: kf.bearing !== undefined ? Number(kf.bearing) : 0,
			zoom: kf.zoom !== undefined ? Number(kf.zoom) : undefined,
		}))
	}
	const bounds = manifestBoundsWgs84(manifest)
	if (!bounds) {
		return []
	}
	return fallbackCameraPath(bounds, frameCount)
}

export function cameraKeyframeForFrame(
	manifest: Inundation3DManifest,
	frameIndex: number,
	frameCount: number,
): CameraKeyframe | null {
	const path = resolveCameraPath(manifest, frameCount)
	if (!path.length) {
		return null
	}
	return path.find((kf) => (kf.frame_index ?? 0) === frameIndex) ?? path[Math.min(frameIndex, path.length - 1)]
}
