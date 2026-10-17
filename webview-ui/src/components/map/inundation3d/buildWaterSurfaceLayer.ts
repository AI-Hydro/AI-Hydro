import type { Layer } from "@deck.gl/core"
import { COORDINATE_SYSTEM } from "@deck.gl/core"
import { SimpleMeshLayer } from "@deck.gl/mesh-layers"
import type { Inundation3DMesh } from "./manifest"
import { meshAnchorAndLocalPositions, meshIndexArray } from "./meshCoordinates"
import { applyMeshVerticalOffset } from "./verticalAlignment"

// Minimum clearance above Terrarium terrain surface to avoid Z-fighting.
// The terrain and HAND mesh share roughly the same datum, so without this
// the terrain tiles render on top of the water and the mesh disappears.
const TERRAIN_CLEARANCE_M = 8

export function buildWaterSurfaceMeshLayer(
	id: string,
	mesh: Inundation3DMesh,
	options?: { opacity?: number; visible?: boolean; verticalOffsetM?: number },
): Layer {
	const offsetM = (options?.verticalOffsetM ?? 0) + TERRAIN_CLEARANCE_M
	const alignedMesh = applyMeshVerticalOffset(mesh, offsetM)
	const { anchor, positions } = meshAnchorAndLocalPositions(alignedMesh)
	const indices = meshIndexArray(alignedMesh)
	const opacity = options?.opacity ?? 0.78
	const visible = options?.visible ?? true

	return new SimpleMeshLayer({
		id,
		data: [anchor],
		coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
		coordinateOrigin: anchor,
		getPosition: (d: [number, number, number]) => d,
		mesh: {
			attributes: {
				positions: { size: 3, value: positions },
			},
			indices: { size: 1, value: indices },
		},
		// Slightly deeper, less saturated blue reads more like open water than
		// the previous flat UI-blue when draped over terrain.
		getColor: [33, 118, 205, Math.round(opacity * 255)],
		opacity,
		visible,
		pickable: false,
		// A subtle specular sheen gives the surface a water-like highlight when
		// the scene has lighting; harmless (no-op) when it does not.
		material: {
			ambient: 0.45,
			diffuse: 0.55,
			shininess: 140,
			specularColor: [180, 215, 255],
		},
		parameters: {
			depthTest: true,
		},
	})
}
