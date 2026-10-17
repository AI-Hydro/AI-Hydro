import { mapLayerToLiveLayer } from "@shared/map/liveLayer"
import type { MapLayer } from "@shared/proto/cline/map"
import React, { useEffect, useMemo, useRef, useState } from "react"
import { useBrushContext } from "../../context/BrushContext"

interface TimeSliderPanelProps {
	layers: MapLayer[]
	visibleLayerIds: Set<string>
	onVisibilityChange: (layerId: string, visible: boolean) => void
	mapStyle?: "dark" | "light"
	/** When set, show hydrograph frame scrubber synced with 3D playback. */
	hydrographFrameIndex?: number
	hydrographFrameCount?: number
	onHydrographFrameChange?: (index: number) => void
}

/**
 * Time slider panel — Phase 3.4.3.
 *
 * Reads `time_start` / `time_end` from `MapLayer.metadata` (via LiveLayer) and
 * shows a date range picker that hides layers whose temporal window falls
 * entirely outside the selected range.  Layers with no time metadata are always
 * shown and listed in a separate "no time range" group.
 */
const TimeSliderPanel: React.FC<TimeSliderPanelProps> = ({
	layers,
	visibleLayerIds,
	onVisibilityChange,
	mapStyle = "dark",
	hydrographFrameIndex,
	hydrographFrameCount = 0,
	onHydrographFrameChange,
}) => {
	const isDark = mapStyle === "dark"
	const fg = isDark ? "var(--vscode-foreground, #ddd)" : "var(--vscode-foreground, #222)"

	// Derive the global min/max date across all time-tagged layers
	const { minDate, maxDate } = useMemo(() => {
		let min = ""
		let max = ""
		for (const layer of layers) {
			const live = mapLayerToLiveLayer(layer)
			if (live.timeStart && (!min || live.timeStart < min)) min = live.timeStart
			if (live.timeEnd && (!max || live.timeEnd > max)) max = live.timeEnd
			else if (live.timeStart && (!max || live.timeStart > max)) max = live.timeStart
		}
		return { minDate: min, maxDate: max }
	}, [layers])

	const { brushExtent, setBrushExtent } = useBrushContext()
	const [rangeStart, setRangeStart] = useState<string>("")
	const [rangeEnd, setRangeEnd] = useState<string>("")

	// Track layers identity so we can reset the filter when the layer set changes
	const prevLayerIdsRef = useRef<string>("")
	useEffect(() => {
		const key = layers
			.map((l) => l.id)
			.sort()
			.join(",")
		if (prevLayerIdsRef.current && prevLayerIdsRef.current !== key) {
			// Layer set changed — clear stale filter so new layers aren't hidden
			setRangeStart("")
			setRangeEnd("")
			setBrushExtent(null)
		}
		prevLayerIdsRef.current = key
	}, [layers, setBrushExtent])

	// Apply the time filter: hide layers that fall entirely outside the range
	const applyFilter = (start: string, end: string) => {
		// Broadcast to BrushContext so linked chart components can highlight the range
		setBrushExtent(start && end ? [start, end] : null)
		for (const layer of layers) {
			const live = mapLayerToLiveLayer(layer)
			if (!live.timeStart) continue // no time metadata — leave as-is
			const layerEnd = live.timeEnd ?? live.timeStart
			if (start && layerEnd < start) {
				// layer ends before range start → hide
				if (visibleLayerIds.has(layer.id)) onVisibilityChange(layer.id, false)
			} else if (end && live.timeStart > end) {
				// layer starts after range end → hide
				if (visibleLayerIds.has(layer.id)) onVisibilityChange(layer.id, false)
			} else {
				// layer overlaps the range → show
				if (!visibleLayerIds.has(layer.id)) onVisibilityChange(layer.id, true)
			}
		}
	}

	// An externally set brush (agent `set_time_range`, linked hydrograph) drives the slider:
	// adopt it as the visible range and apply the same layer filter a manual edit would.
	// Our own applyFilter echoes a date-only extent back here; that equals local state, so it is a no-op.
	// biome-ignore lint/correctness/useExhaustiveDependencies: applyFilter is re-created each render by design
	useEffect(() => {
		if (!brushExtent) return
		const start = brushExtent[0].slice(0, 10)
		const end = brushExtent[1].slice(0, 10)
		if (start === rangeStart && end === rangeEnd) return
		setRangeStart(start)
		setRangeEnd(end)
		applyFilter(start, end)
	}, [brushExtent])

	const timedLayers = layers.filter((l) => mapLayerToLiveLayer(l).timeStart)
	const untimedLayers = layers.filter((l) => !mapLayerToLiveLayer(l).timeStart)

	if (timedLayers.length === 0) {
		return (
			<div style={{ fontSize: 11, opacity: 0.65, color: fg, textAlign: "center", padding: "16px 4px" }}>
				No time-tagged layers.
				<br />
				Add <code>time_start</code> to a layer's metadata to enable filtering.
			</div>
		)
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 10, color: fg, fontSize: 11 }}>
			{hydrographFrameCount > 1 && onHydrographFrameChange && hydrographFrameIndex !== undefined && (
				<div>
					<div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Hydrograph frame (3D sync)</div>
					<div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
						<span>Frame</span>
						<span>
							{hydrographFrameIndex + 1} / {hydrographFrameCount}
						</span>
					</div>
					<input
						max={hydrographFrameCount - 1}
						min={0}
						onChange={(e) => onHydrographFrameChange(Number(e.target.value))}
						step={1}
						style={{ width: "100%" }}
						type="range"
						value={hydrographFrameIndex}
					/>
				</div>
			)}

			<div style={{ fontWeight: 600, fontSize: 12 }}>Filter by date range</div>

			<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
				<label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
					<span style={{ opacity: 0.7 }}>From</span>
					<input
						max={rangeEnd || maxDate}
						min={minDate}
						onChange={(e) => {
							setRangeStart(e.target.value)
							applyFilter(e.target.value, rangeEnd)
						}}
						style={{
							fontSize: 11,
							padding: "3px 4px",
							borderRadius: 3,
							border: "1px solid rgba(255,255,255,0.15)",
							background: "var(--vscode-input-background, #3c3c3c)",
							color: fg,
						}}
						type="date"
						value={rangeStart}
					/>
				</label>
				<label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
					<span style={{ opacity: 0.7 }}>To</span>
					<input
						max={maxDate}
						min={rangeStart || minDate}
						onChange={(e) => {
							setRangeEnd(e.target.value)
							applyFilter(rangeStart, e.target.value)
						}}
						style={{
							fontSize: 11,
							padding: "3px 4px",
							borderRadius: 3,
							border: "1px solid rgba(255,255,255,0.15)",
							background: "var(--vscode-input-background, #3c3c3c)",
							color: fg,
						}}
						type="date"
						value={rangeEnd}
					/>
				</label>
			</div>

			{(rangeStart || rangeEnd) && (
				<button
					onClick={() => {
						setRangeStart("")
						setRangeEnd("")
						applyFilter("", "")
					}}
					style={{
						fontSize: 10,
						padding: "3px 8px",
						borderRadius: 3,
						border: "1px solid rgba(255,255,255,0.15)",
						background: "transparent",
						color: fg,
						cursor: "pointer",
						alignSelf: "flex-start",
					}}
					type="button">
					Clear filter
				</button>
			)}

			<div style={{ marginTop: 4, opacity: 0.6 }}>
				{timedLayers.length} time-tagged layer{timedLayers.length !== 1 ? "s" : ""}
				{untimedLayers.length > 0 && ` · ${untimedLayers.length} always visible`}
			</div>
		</div>
	)
}

export default TimeSliderPanel
