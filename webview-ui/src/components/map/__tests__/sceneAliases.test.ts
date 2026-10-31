import { describe, expect, it } from "vitest"
import { followAlias, remapSceneIds } from "../sceneAliases"

describe("scene aliases", () => {
	const aliases = { "user-a": "workspace_a" }
	it("maps a merged-away id to the layer that stayed, in visibility, order and opacity", () => {
		const scene = remapSceneIds(
			{
				visibleLayerIds: ["user-a", "x"],
				layerOrder: ["x", "user-a", "workspace_a"],
				layerOpacities: { "user-a": 0.4, x: 1 },
			},
			aliases,
		)
		expect(scene.visibleLayerIds).toEqual(["workspace_a", "x"])
		expect(scene.layerOrder).toEqual(["x", "workspace_a"])
		expect(scene.layerOpacities).toEqual({ workspace_a: 0.4, x: 1 })
	})
	it("does not add back a layer whose id was merged away, and leaves a scene alone when there are no aliases", () => {
		const scene = { layers: [{ id: "user-a" }, { id: "x" }] }
		expect(remapSceneIds(scene, aliases).layers).toEqual([{ id: "x" }])
		expect(remapSceneIds(scene, {})).toBe(scene)
	})
	it("the survivor's own opacity wins over an alias's", () => {
		expect(remapSceneIds({ layerOpacities: { workspace_a: 0.9, "user-a": 0.1 } }, aliases).layerOpacities).toEqual({
			workspace_a: 0.9,
		})
		expect(followAlias("loop", { loop: "loop" })).toBe("loop")
	})
})
