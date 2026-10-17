import type { MapLayer } from "@shared/proto/cline/map"
import React, { useMemo, useState } from "react"

interface StageLookupEntry {
	stageM: number
	cells: number
}

interface InundationScrubberPanelProps {
	layers: MapLayer[]
	mapStyle?: "dark" | "light"
}

function parseStageLookup(raw: string | undefined): StageLookupEntry[] {
	if (!raw) return []
	try {
		const parsed = JSON.parse(raw) as Record<string, number>
		return Object.entries(parsed)
			.map(([stage, cells]) => ({ stageM: Number(stage), cells: Number(cells) }))
			.filter((e) => Number.isFinite(e.stageM) && Number.isFinite(e.cells))
			.sort((a, b) => a.stageM - b.stageM)
	} catch {
		return []
	}
}

function isInundationLayer(layer: MapLayer): boolean {
	const meta = layer.metadata ?? {}
	return meta.tool === "map_flood_inundation" || meta.source === "HAND+SRC" || !!meta.stage_lookup_json
}

export const InundationScrubberPanel: React.FC<InundationScrubberPanelProps> = ({ layers, mapStyle = "dark" }) => {
	const isDark = mapStyle === "dark"
	const fg = isDark ? "var(--vscode-foreground, #ddd)" : "var(--vscode-foreground, #222)"

	const inundationLayers = useMemo(() => layers.filter(isInundationLayer), [layers])

	const [selectedId, setSelectedId] = useState<string>("")

	const activeLayer = useMemo(() => {
		const id = selectedId || inundationLayers[0]?.id
		return inundationLayers.find((l) => l.id === id) ?? inundationLayers[0]
	}, [inundationLayers, selectedId])

	const lookup = useMemo(
		() => parseStageLookup(activeLayer?.metadata?.stage_lookup_json),
		[activeLayer?.metadata?.stage_lookup_json],
	)

	const [stageIdx, setStageIdx] = useState(0)

	const activeEntry = lookup[Math.min(stageIdx, Math.max(0, lookup.length - 1))]
	const discharge = activeLayer?.metadata?.discharge_m3s
	const caveat = activeLayer?.metadata?.caveat

	if (inundationLayers.length === 0) {
		return (
			<div style={{ fontSize: 11, opacity: 0.65, color: fg, textAlign: "center", padding: "16px 4px" }}>
				No inundation layers on the map.
				<br />
				Run <code>map_flood_inundation</code> to add HAND depth + extent layers.
			</div>
		)
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 12, color: fg }}>
			<div style={{ fontSize: 11, opacity: 0.8, lineHeight: 1.5 }}>
				Stage scrubber reads <code>stage_lookup_json</code> from inundation map metadata. Displays extent proxy (inundated
				cell count) — re-map at a new discharge requires re-running the MCP tool.
			</div>

			{inundationLayers.length > 1 && (
				<div>
					<span style={{ fontSize: 10, fontWeight: 600, opacity: 0.75 }}>Layer</span>
					<select
						onChange={(e) => {
							setSelectedId(e.target.value)
							setStageIdx(0)
						}}
						style={{
							width: "100%",
							marginTop: 4,
							fontSize: 11,
							padding: "3px 6px",
							background: "var(--vscode-input-background)",
							color: "var(--vscode-input-foreground)",
							border: "1px solid var(--vscode-input-border)",
							borderRadius: 3,
						}}
						value={activeLayer?.id ?? ""}>
						{inundationLayers.map((l) => (
							<option key={l.id} value={l.id}>
								{l.name}
							</option>
						))}
					</select>
				</div>
			)}

			{discharge && (
				<div style={{ fontSize: 11 }}>
					<strong>Q</strong> = {discharge} m³/s
					{activeLayer?.metadata?.discharge_source ? (
						<span style={{ opacity: 0.7 }}> ({activeLayer.metadata.discharge_source})</span>
					) : null}
				</div>
			)}

			{lookup.length > 1 ? (
				<div
					style={{
						padding: 10,
						background: "rgba(0,0,0,0.08)",
						borderRadius: 6,
					}}>
					<div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
						<span style={{ fontSize: 10, fontWeight: 600 }}>Stage (m)</span>
						<span style={{ fontSize: 11, fontWeight: 700 }}>{activeEntry?.stageM.toFixed(2) ?? "—"}</span>
					</div>
					<input
						max={lookup.length - 1}
						min={0}
						onChange={(e) => setStageIdx(Number(e.target.value))}
						style={{ width: "100%", cursor: "pointer" }}
						type="range"
						value={stageIdx}
					/>
					<div style={{ fontSize: 10, opacity: 0.75, marginTop: 6 }}>
						Inundated cells (proxy): <strong>{activeEntry?.cells ?? 0}</strong>
					</div>
				</div>
			) : (
				<div style={{ fontSize: 10, opacity: 0.65 }}>No stage lookup in layer metadata.</div>
			)}

			{caveat && (
				<div
					style={{
						fontSize: 10,
						lineHeight: 1.45,
						padding: 8,
						borderRadius: 4,
						background: "rgba(200, 120, 0, 0.12)",
						border: "1px solid rgba(200, 120, 0, 0.35)",
					}}>
					⚠ {caveat}
				</div>
			)}
		</div>
	)
}

export default InundationScrubberPanel
