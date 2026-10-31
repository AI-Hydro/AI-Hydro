import { layerRunId, layerTool } from "@shared/map/provenanceEnvelope"
import React, { useEffect, useState } from "react"
import { PLATFORM_CONFIG } from "../../config/platform.config"
import { GAUGE_BLOCK_KEYS, gaugeInfo } from "./gaugeInfo"
import { actionTooltip, KIND_LABEL, type MapActionId, mapActions, objectKind } from "./mapActions"
import type { CursorRasterReading } from "./mapLayerAdapters"
import { MAP_Z } from "./mapZ"
import { type OverflowItem, OverflowMenu } from "./OverflowMenu"
import { PhotoStrip } from "./PhotoStrip"
import { extractPhotoPaths } from "./photoPaths"

export interface ClickedFeature {
	layerId: string
	layerName: string
	properties: Record<string, unknown>
	geometry?: unknown
}

export interface MapInspectPoint {
	lon: number
	lat: number
}

interface FeatureIdentifierProps {
	features: ClickedFeature[]
	inspectPoint?: MapInspectPoint | null
	rasterReading?: CursorRasterReading | null
	mapStyle: string
	onClose: () => void
	onAgentDelineate?: (point: MapInspectPoint) => void | Promise<void>
	onAgentAsk?: (point: MapInspectPoint) => void | Promise<void>
	onQuickDelineate?: (point: MapInspectPoint) => void | Promise<void>
	onAddSelection?: (features: ClickedFeature[]) => void
	onClearSelection?: () => void
	onSaveFeatures?: (features: ClickedFeature[], format: "geojson" | "shapefile") => void | Promise<void>
	selectedFeatures?: ClickedFeature[]
	agentStarting?: boolean
	agentStatus?: string | null
	delineating?: boolean
	delineateStatus?: string | null
	/** Layer metadata by id, for the run line (tool, run, study). */
	layerMetadata?: (layerId: string) => Record<string, string> | undefined
	onAddPin?: (point: MapInspectPoint) => void
	onMeasureFrom?: (point: MapInspectPoint) => void
	onCopyCoords?: (point: MapInspectPoint) => void
	onRemoveLayer?: (layerId: string) => void | Promise<void>
}

/** How many properties show before "Show all". */
const PROPS_SHOWN = 6

/** Bottom-right selection card: what was clicked, the run behind it, and one action list (`mapActions`). */
const FeatureIdentifier: React.FC<FeatureIdentifierProps> = ({
	features,
	inspectPoint,
	rasterReading,
	mapStyle,
	onClose,
	onAgentDelineate,
	onAgentAsk,
	onQuickDelineate,
	onAddSelection,
	onClearSelection,
	onSaveFeatures,
	selectedFeatures = [],
	agentStarting = false,
	agentStatus,
	delineating = false,
	delineateStatus,
	layerMetadata,
	onAddPin,
	onMeasureFrom,
	onCopyCoords,
	onRemoveLayer,
}) => {
	const [currentIndex, setCurrentIndex] = useState(0)
	const [showAll, setShowAll] = useState(false)

	useEffect(() => {
		setCurrentIndex(0)
		setShowAll(false)
	}, [features])

	if (features.length === 0 && !inspectPoint && !rasterReading) {
		return null
	}

	const current = features[currentIndex]
	const hasFeatures = features.length > 0
	const isDark = mapStyle === "dark"
	const bg = isDark ? "rgba(22,22,30,0.94)" : "rgba(252,252,252,0.96)"
	const fg = isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.88)"
	const bdClr = isDark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.12)"
	const muted = isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.55)"
	const accentText = isDark ? "#7ec8ff" : "#0e639c"

	const photoPaths = hasFeatures ? extractPhotoPaths(current.properties.photos) : []
	const PHOTO_KEYS = new Set(["photos", "photo_count"])
	const kindNow = objectKind(hasFeatures ? [current] : [])
	const gauge = kindNow === "gauge" ? gaugeInfo(current.properties) : null
	// The gauge block shows the site, name and label; the list below it does not repeat them.
	const allEntries = hasFeatures
		? Object.entries(current.properties).filter(
				([k]) => !k.startsWith("_") && !PHOTO_KEYS.has(k) && !(gauge && GAUGE_BLOCK_KEYS.has(k)),
			)
		: []
	const entries = showAll ? allEntries : allEntries.slice(0, PROPS_SHOWN)
	const extra = allEntries.length - PROPS_SHOWN

	const coordLine =
		inspectPoint &&
		`${Math.abs(inspectPoint.lat).toFixed(5)}°${inspectPoint.lat >= 0 ? "N" : "S"}, ${Math.abs(inspectPoint.lon).toFixed(5)}°${inspectPoint.lon >= 0 ? "E" : "W"}`

	const kind = objectKind(features.length > 0 ? [current] : [])
	const meta = hasFeatures ? layerMetadata?.(current.layerId) : undefined
	const tool = layerTool(meta)
	const runId = layerRunId(meta)
	const studyId = meta?.study_id
	const runLine = runId
		? `${tool ?? "run"} · run ${runId.slice(0, 8)}`
		: meta?.source && ["merit", "wbd", "nwis", "nid"].includes(meta.source)
			? "Reference, not in any run"
			: tool
				? `${tool} · no run record`
				: undefined

	const btnStyle: React.CSSProperties = {
		width: 24,
		height: 24,
		padding: 0,
		border: `1px solid ${bdClr}`,
		background: "transparent",
		color: fg,
		cursor: "pointer",
		borderRadius: 3,
		fontSize: 11,
		lineHeight: 1,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
	}

	const primaryBtn: React.CSSProperties = {
		flex: 1,
		minHeight: 24,
		padding: "4px 8px",
		fontSize: 11,
		fontWeight: 600,
		cursor: agentStarting ? "wait" : "pointer",
		border: `1px solid ${bdClr}`,
		borderRadius: 4,
		background: isDark ? "rgba(30,90,140,0.55)" : "rgba(14,99,156,0.18)",
		color: accentText,
		opacity: agentStarting ? 0.7 : 1,
	}

	const linkBtn: React.CSSProperties = {
		minHeight: 24,
		padding: "0 4px",
		border: "none",
		background: "transparent",
		color: accentText,
		cursor: "pointer",
		fontSize: 11,
		textDecoration: "underline",
	}

	const currentSelection = current?.geometry ? [current] : []
	const selectedCount = selectedFeatures.filter((feature) => feature.geometry).length
	const point = inspectPoint ?? null

	// One handler per action id. An action with no handler is not offered, so the card never shows a dead button.
	const handlers: Partial<Record<MapActionId, () => void>> = point
		? {
				ask: onAgentAsk ? () => void onAgentAsk(point) : undefined,
				delineate: onAgentDelineate ? () => void onAgentDelineate(point) : undefined,
				"delineate-quick": onQuickDelineate ? () => void onQuickDelineate(point) : undefined,
				"add-pin": onAddPin ? () => onAddPin(point) : undefined,
				measure: onMeasureFrom ? () => onMeasureFrom(point) : undefined,
				"copy-coords": () => {
					void navigator.clipboard?.writeText(`${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`)
					onCopyCoords?.(point)
				},
			}
		: {}
	if (currentSelection.length > 0) {
		handlers.select = onAddSelection ? () => onAddSelection(currentSelection) : undefined
		handlers["export-geojson"] = onSaveFeatures ? () => void onSaveFeatures(currentSelection, "geojson") : undefined
		handlers["export-shapefile"] = onSaveFeatures ? () => void onSaveFeatures(currentSelection, "shapefile") : undefined
	}
	if (hasFeatures && onRemoveLayer) {
		handlers["remove-layer"] = () => void onRemoveLayer(current.layerId)
	}
	const offered = mapActions(kind, "card").filter((a) => handlers[a.id])
	const primary = offered.filter((a) => a.id === "ask" || a.id === "delineate")
	const overflow: OverflowItem[] = offered
		.filter((a) => a.id !== "ask" && a.id !== "delineate")
		.map((a) => ({
			key: a.id,
			label: a.label,
			icon: a.icon,
			danger: a.danger,
			title: actionTooltip(a.id, current, point),
			disabledReason: a.id === "delineate-quick" && (delineating || agentStarting) ? "Another run is starting" : undefined,
			onSelect: () => handlers[a.id]?.(),
		}))
	const showActions = primary.length > 0 || overflow.length > 0

	return (
		<div
			aria-label="Feature inspector"
			role="dialog"
			style={{
				position: "absolute",
				bottom: 48,
				right: 52,
				zIndex: MAP_Z.panel,
				width: "max-content",
				minWidth: 200,
				maxWidth: 280,
				maxHeight: 360,
				display: "flex",
				flexDirection: "column",
				background: bg,
				border: `1px solid ${bdClr}`,
				borderRadius: 6,
				boxShadow: "0 2px 10px rgba(0,0,0,0.32)",
				fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
				fontSize: 11,
				color: fg,
				pointerEvents: "auto",
			}}>
			{/* Compact header */}
			<div
				style={{
					padding: "6px 8px",
					borderBottom: entries.length > 0 || rasterReading || showActions ? `1px solid ${bdClr}` : undefined,
					display: "flex",
					alignItems: "flex-start",
					gap: 6,
					flexShrink: 0,
				}}>
				<div style={{ flex: 1, minWidth: 0 }}>
					{hasFeatures ? (
						<div
							style={{
								fontSize: 12,
								fontWeight: 600,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
								lineHeight: 1.3,
							}}
							title={current.layerName}>
							{current.layerName}
						</div>
					) : (
						<div style={{ fontSize: 11, fontWeight: 600 }}>Map click</div>
					)}
					<div style={{ fontSize: 11, color: muted, marginTop: 2, lineHeight: 1.3 }}>
						{KIND_LABEL[kind]}
						{coordLine && (
							<>
								{" · "}
								<span style={{ fontFamily: "var(--vscode-editor-font-family, monospace)" }}>{coordLine}</span>
							</>
						)}
					</div>
					{runLine && (
						<div style={{ fontSize: 11, color: muted, marginTop: 2, lineHeight: 1.3 }}>
							{runLine}
							{runId && studyId && (
								<>
									{" · "}
									<button
										onClick={() =>
											PLATFORM_CONFIG.postMessage({
												type: "aihydro-map-open-run",
												study_id: studyId,
												run_id: runId,
											})
										}
										style={linkBtn}
										title="Open this run in Replay"
										type="button">
										Open
									</button>
								</>
							)}
						</div>
					)}
				</div>
				{hasFeatures && features.length > 1 && (
					<div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
						<button
							aria-label="Previous feature"
							onClick={() => setCurrentIndex((i) => (i === 0 ? features.length - 1 : i - 1))}
							style={btnStyle}
							title="Previous feature"
							type="button">
							<span aria-hidden="true" className="codicon codicon-chevron-left" />
						</button>
						<span style={{ fontSize: 11, color: muted, minWidth: 28, textAlign: "center" }}>
							{currentIndex + 1}/{features.length}
						</span>
						<button
							aria-label="Next feature"
							onClick={() => setCurrentIndex((i) => (i === features.length - 1 ? 0 : i + 1))}
							style={btnStyle}
							title="Next feature"
							type="button">
							<span aria-hidden="true" className="codicon codicon-chevron-right" />
						</button>
					</div>
				)}
				<button
					aria-label="Close inspector"
					onClick={onClose}
					style={{ ...btnStyle, flexShrink: 0, opacity: 0.85 }}
					title="Close"
					type="button">
					<span aria-hidden="true" className="codicon codicon-close" />
				</button>
			</div>

			{(rasterReading || gauge || entries.length > 0 || (!hasFeatures && !rasterReading) || showActions) && (
				<div style={{ padding: "6px 8px", overflowY: "auto", flex: 1, minHeight: 0 }}>
					{rasterReading && (
						<div style={{ marginBottom: entries.length > 0 ? 6 : 0, fontSize: 11 }}>
							<span style={{ color: muted }}>{rasterReading.layerName}: </span>
							<span style={{ color: accentText, fontFamily: "monospace" }}>
								{Number.isFinite(rasterReading.value) ? rasterReading.value.toPrecision(4) : "—"}
								{rasterReading.units ? ` ${rasterReading.units}` : ""}
							</span>
						</div>
					)}
					{!hasFeatures && !rasterReading && (
						<div style={{ fontSize: 11, color: muted, fontStyle: "italic" }}>No features at this point.</div>
					)}
					{gauge && (
						<div aria-label="Gauge" role="group" style={{ marginBottom: 6 }}>
							{(
								[
									["Site", `USGS ${gauge.siteNo}`],
									["Name", gauge.name ?? "not reported"],
									["Drainage area", gauge.drainageArea ?? "not reported"],
									["Record", gauge.periodOfRecord ?? "not reported"],
								] as const
							).map(([label, value]) => (
								<div
									key={label}
									style={{
										display: "grid",
										gridTemplateColumns: "72px 1fr",
										gap: "2px 8px",
										marginBottom: 3,
										fontSize: 11,
									}}>
									<span style={{ color: muted }}>{label}</span>
									<span
										style={{
											color: value === "not reported" ? muted : accentText,
											fontStyle: value === "not reported" ? "italic" : undefined,
											wordBreak: "break-word",
											lineHeight: 1.35,
										}}>
										{value}
									</span>
								</div>
							))}
							{gauge.usgsUrl && (
								<button
									onClick={() => PLATFORM_CONFIG.postMessage({ type: "openExternal", url: gauge.usgsUrl })}
									style={linkBtn}
									title="Open the USGS monitoring-location page in your browser"
									type="button">
									USGS page
								</button>
							)}
						</div>
					)}
					{entries.map(([key, value]) => (
						<div
							key={key}
							style={{
								display: "grid",
								gridTemplateColumns: "72px 1fr",
								gap: "2px 8px",
								marginBottom: 3,
								fontSize: 11,
								alignItems: "start",
							}}>
							<span style={{ color: muted, overflow: "hidden", textOverflow: "ellipsis" }} title={key}>
								{key}
							</span>
							<span
								style={{
									color: accentText,
									fontFamily: "var(--vscode-editor-font-family, monospace)",
									wordBreak: "break-word",
									lineHeight: 1.35,
								}}>
								{String(value ?? "—")}
							</span>
						</div>
					))}
					{extra > 0 && (
						<button aria-expanded={showAll} onClick={() => setShowAll((v) => !v)} style={linkBtn} type="button">
							{showAll ? "Show fewer" : `Show all (${allEntries.length})`}
						</button>
					)}
					{photoPaths.length > 0 && (
						<div style={{ marginTop: 8 }}>
							<div style={{ fontSize: 11, color: muted, marginBottom: 4 }}>
								{photoPaths.length} site photo{photoPaths.length > 1 ? "s" : ""}
							</div>
							<PhotoStrip paths={photoPaths} />
						</div>
					)}
					{showActions && (
						<div style={{ marginTop: 8 }}>
							<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
								{primary.map((a) => (
									<button
										disabled={agentStarting || delineating}
										key={a.id}
										onClick={() => handlers[a.id]?.()}
										style={primaryBtn}
										title={actionTooltip(a.id, current, point)}
										type="button">
										{agentStarting && a.id === "delineate" ? "Opening chat…" : a.label}
									</button>
								))}
								{overflow.length > 0 && <OverflowMenu items={overflow} label="More actions for this selection" />}
							</div>
							{selectedCount > 0 && onSaveFeatures && (
								<div
									style={{
										marginTop: 6,
										padding: 6,
										borderRadius: 4,
										background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
										border: `1px solid ${bdClr}`,
									}}>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: 6,
											marginBottom: 5,
											fontSize: 11,
											color: muted,
										}}>
										<span style={{ flex: 1 }}>{selectedCount} selected</span>
										{onClearSelection && (
											<button
												aria-label="Clear selected features"
												onClick={onClearSelection}
												style={btnStyle}
												title="Clear selected features"
												type="button">
												<span aria-hidden="true" className="codicon codicon-close" />
											</button>
										)}
									</div>
									<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
										<button
											onClick={() => void onSaveFeatures(selectedFeatures, "geojson")}
											style={{ ...primaryBtn, background: "transparent", fontWeight: 500 }}
											title="Save selected features as GeoJSON"
											type="button">
											Save GeoJSON
										</button>
										<button
											onClick={() => void onSaveFeatures(selectedFeatures, "shapefile")}
											style={{ ...primaryBtn, background: "transparent", fontWeight: 500 }}
											title="Save selected features as a zipped shapefile"
											type="button">
											Save shapefile
										</button>
									</div>
								</div>
							)}
							{(agentStatus || delineateStatus) && (
								<div style={{ marginTop: 6, fontSize: 11, color: muted, lineHeight: 1.35 }}>
									{agentStatus || delineateStatus}
								</div>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	)
}

export default FeatureIdentifier
