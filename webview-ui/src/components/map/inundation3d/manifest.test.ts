import { describe, expect, it } from "vitest"
import { meshForFrame, parseInundation3DManifest } from "./manifest"

describe("inundation3d manifest", () => {
	it("parses embedded manifest with frames", () => {
		const raw = JSON.stringify({
			version: 1,
			frames: [
				{
					index: 0,
					mesh: {
						positions: [0, 0, 10, 1, 0, 11, 0, 1, 12],
						indices: [0, 1, 2],
					},
				},
			],
		})
		const manifest = parseInundation3DManifest(raw)
		expect(manifest?.frames?.length).toBe(1)
		const mesh = meshForFrame(manifest!, 0)
		expect(mesh?.positions.length).toBe(9)
	})
})
