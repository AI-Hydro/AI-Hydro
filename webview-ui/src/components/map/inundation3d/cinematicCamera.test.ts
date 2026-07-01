import { describe, expect, it } from "vitest"
import { cameraKeyframeForFrame, resolveCameraPath } from "./cinematicCamera"
import type { Inundation3DManifest } from "./manifest"

describe("cinematicCamera", () => {
	it("uses manifest camera_path when present", () => {
		const manifest: Inundation3DManifest = {
			bounds_wgs84: [-68.1, 44.5, -67.9, 44.6],
			camera_path: [
				{ frame_index: 0, longitude: -68.1, latitude: 44.55, pitch: 52, bearing: 90 },
				{ frame_index: 1, longitude: -68.0, latitude: 44.55, pitch: 52, bearing: 90 },
			],
			frames: [{ index: 0 }, { index: 1 }],
		}
		const path = resolveCameraPath(manifest, 2)
		expect(path).toHaveLength(2)
		const kf = cameraKeyframeForFrame(manifest, 1, 2)
		expect(kf?.longitude).toBe(-68.0)
	})

	it("falls back to bounds-derived path", () => {
		const manifest: Inundation3DManifest = {
			bounds_wgs84: [0, 0, 1, 1],
			frames: [{ index: 0 }, { index: 1 }, { index: 2 }],
		}
		expect(resolveCameraPath(manifest, 3)).toHaveLength(3)
	})
})
