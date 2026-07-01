import type { MapLayer } from "@shared/proto/cline/map"
import React, { useMemo } from "react"
import { findInundation3DManifestLayer } from "./inundation3d/manifest"

export interface Inundation3DControlsProps {
	layers: MapLayer[]
	enabled: boolean
	onEnabledChange: (enabled: boolean) => void
	terrainEnabled: boolean
	onTerrainEnabledChange: (enabled: boolean) => void
	frameIndex: number
	onFrameIndexChange: (index: number) => void
	cinematicCamera: boolean
	onCinematicCameraChange: (enabled: boolean) => void
	playbackActive: boolean
	onPlaybackActiveChange: (active: boolean) => void
	frameCount: number
	meshTriangleCount?: number
	mapStyle?: "dark" | "light"
}

export const Inundation3DControls: React.FC<Inundation3DControlsProps> = ({
	layers,
	enabled,
	onEnabledChange,
	terrainEnabled,
	onTerrainEnabledChange,
	frameIndex,
	onFrameIndexChange,
	cinematicCamera,
	onCinematicCameraChange,
	playbackActive,
	onPlaybackActiveChange,
	frameCount,
	meshTriangleCount: flood3dMeshTriangles = 0,
	mapStyle = "dark",
}) => {
	const isDark = mapStyle === "dark"
	const fg = isDark ? "var(--vscode-foreground, #ddd)" : "var(--vscode-foreground, #222)"

	const found = useMemo(() => findInundation3DManifestLayer(layers), [layers])
	const manifest = found?.manifest
	const frames = manifest?.frames ?? []
	const maxFrame = Math.max(0, frames.length - 1)
	const activeFrame = frames[Math.min(frameIndex, maxFrame)]

	const hasFloodRaster = useMemo(
		() =>
			layers.some((layer) => {
				const meta = layer.metadata ?? {}
				return (
					layer.layerType === "raster" &&
					(meta.tool === "map_flood_inundation" ||
						meta.tool === "map_flood_inundation_hydrograph" ||
						meta.source === "HAND+SRC")
				)
			}),
		[layers],
	)

	if (!manifest) {
		return (
			<div
				style={{
					fontSize: 11,
					opacity: 0.65,
					color: fg,
					marginTop: 12,
					paddingTop: 10,
					borderTop: "1px solid rgba(255,255,255,0.08)",
				}}>
				<strong>3D flood view</strong>
				{hasFloodRaster ? (
					<div style={{ marginTop: 6, lineHeight: 1.45 }}>
						2D flood map is loaded, but the <strong>3D mesh manifest is missing</strong> (usually because an older run
						failed silently).
						<div style={{ marginTop: 6 }}>
							Re-run <code>map_flood_inundation</code> in chat for this session, then reload the map panel. The
							Enable 3D checkbox will appear once the manifest attaches.
						</div>
					</div>
				) : (
					<div style={{ marginTop: 6 }}>
						Run <code>map_flood_inundation</code> or <code>map_flood_inundation_hydrograph</code> to generate a 3D
						mesh manifest.
					</div>
				)}
			</div>
		)
	}

	return (
		<div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)", color: fg, fontSize: 11 }}>
			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
				<strong>3D flood view</strong>
				<label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
					<input checked={enabled} onChange={(e) => onEnabledChange(e.target.checked)} type="checkbox" />
					Enable 3D view
				</label>
			</div>

			{enabled && (
				<label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginTop: 8 }}>
					<input checked={terrainEnabled} onChange={(e) => onTerrainEnabledChange(e.target.checked)} type="checkbox" />
					Terrarium hillshade terrain (context)
				</label>
			)}

			{manifest.caveat && <div style={{ marginTop: 6, opacity: 0.75, lineHeight: 1.35 }}>{manifest.caveat}</div>}

			{enabled && flood3dMeshTriangles > 0 && flood3dMeshTriangles < 8 && (
				<div style={{ marginTop: 6, opacity: 0.85, lineHeight: 1.35, color: "#ffb74d" }}>
					3D mesh is very sparse ({flood3dMeshTriangles} triangles). Re-run <code>map_flood_inundation</code> after
					updating, or keep the 2D depth layer visible as reference.
				</div>
			)}

			{manifest.camera_path_source && enabled && (
				<div style={{ marginTop: 4, opacity: 0.65, fontSize: 10 }}>
					Camera path: <code>{manifest.camera_path_source}</code>
				</div>
			)}

			{enabled && terrainEnabled && manifest.terrain_vertical_offset_m != null && (
				<div style={{ marginTop: 4, opacity: 0.65, fontSize: 10, lineHeight: 1.35 }}>
					Vertical align:{" "}
					<code>
						{manifest.terrain_vertical_offset_m >= 0 ? "+" : ""}
						{Number(manifest.terrain_vertical_offset_m).toFixed(1)} m
					</code>{" "}
					({manifest.mesh_vertical_datum ?? "mesh"} → {manifest.terrain_vertical_datum ?? "terrain"})
				</div>
			)}

			{enabled && frameCount > 1 && (
				<label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginTop: 8 }}>
					<input
						checked={cinematicCamera}
						onChange={(e) => onCinematicCameraChange(e.target.checked)}
						type="checkbox"
					/>
					Cinematic camera (follow AOI traverse)
				</label>
			)}

			{enabled && (
				<div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
					<button
						onClick={() => onPlaybackActiveChange(!playbackActive)}
						style={{
							fontSize: 11,
							padding: "4px 10px",
							borderRadius: 3,
							border: "1px solid rgba(255,255,255,0.15)",
							background: playbackActive ? "rgba(30,136,229,0.35)" : "transparent",
							color: fg,
							cursor: "pointer",
						}}
						type="button">
						{playbackActive ? "Pause" : "Play"} {frameCount > 1 ? "hydrograph" : "flyaround"}
					</button>
					<span style={{ opacity: 0.7 }}>
						{frameCount > 1
							? playbackActive
								? "Animating frames…"
								: "Step through rising flood"
							: playbackActive
								? "Orbiting basin…"
								: "Cinematic orbit of this snapshot"}
					</span>
				</div>
			)}

			{frames.length > 1 && enabled && (
				<div style={{ marginTop: 10 }}>
					<div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
						<span>Animation frame</span>
						<span>
							{frameIndex + 1} / {frames.length}
						</span>
					</div>
					<input
						max={maxFrame}
						min={0}
						onChange={(e) => onFrameIndexChange(Number(e.target.value))}
						step={1}
						style={{ width: "100%" }}
						type="range"
						value={Math.min(frameIndex, maxFrame)}
					/>
					{activeFrame?.discharge_m3s != null && (
						<div style={{ marginTop: 4, opacity: 0.8 }}>
							Q = {Number(activeFrame.discharge_m3s).toFixed(0)} m³/s
							{activeFrame.stage_m != null ? ` · stage ${Number(activeFrame.stage_m).toFixed(2)} m` : ""}
						</div>
					)}
				</div>
			)}

			{enabled && (
				<div style={{ marginTop: 8, opacity: 0.7 }}>
					Right-drag to rotate. Water mesh uses HAND DEM{terrainEnabled ? " (EGM96-lite shift when terrain on)" : ""};
					terrain uses Terrarium tiles. Extent polygons sync to the selected frame. Frame scrubber also appears in the
					🕐 time panel.
				</div>
			)}
		</div>
	)
}

export default Inundation3DControls
