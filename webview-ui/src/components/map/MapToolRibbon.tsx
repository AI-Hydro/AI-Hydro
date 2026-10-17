/**
 * MapToolRibbon — single docked column of icons on the right edge of the map,
 * with a slide-out panel area. Replaces the previous pair of floating widgets
 * (basemap dropdown + collapsed layer button) with a unified surface.
 *
 *      ┌─────────┬───┐
 *      │         │ ▦ │  ← active panel (basemap / layers / future tools)
 *      │ active  │ 📑│
 *      │ panel   │ ⛶ │
 *      │         │   │
 *      └─────────┴───┘
 *
 * The ribbon is *always* visible. Clicking an icon toggles its panel; clicking
 * an already-active icon collapses it. Only one panel is open at a time. When
 * everything is collapsed, only the icon strip is shown — the map gets the
 * full canvas.
 *
 * Tools today: Basemap, Layers. Future: Measure, Tools/Plugins, Settings.
 */

import type { MapViewState } from "@deck.gl/core"
import type { MapLayer } from "@shared/proto/cline/map"
import React, { useEffect, useState } from "react"
import { BasemapList } from "./BaseMapSelector"
import HydrographyPanel from "./HydrographyPanel"
import { LayerPanelContent } from "./LayerPanel"
import MapExport from "./MapExport"
import { loadMapWorkspace, saveMapWorkspace } from "./mapWorkspace"
import ResearchGalleryPanel from "./ResearchGalleryPanel"

export type RibbonTool =
	| "basemap"
	| "layers"
	| "gallery"
	| "hydrography"
	| "search"
	| "measure"
	| "draw"
	| "transect"
	| "annotations"
	| "swipe"
	| "flood"
	| "time"
	| "export"
	| null

const TOOL_PANEL_SIZE: Record<
	Exclude<RibbonTool, null>,
	{ width: number; height: number; minWidth: number; minHeight: number; maxWidth: number; maxHeightRatio: number }
> = {
	basemap: { width: 300, height: 420, minWidth: 240, minHeight: 240, maxWidth: 420, maxHeightRatio: 0.78 },
	layers: { width: 340, height: 500, minWidth: 280, minHeight: 280, maxWidth: 520, maxHeightRatio: 0.85 },
	gallery: { width: 620, height: 560, minWidth: 420, minHeight: 360, maxWidth: 820, maxHeightRatio: 0.86 },
	hydrography: { width: 380, height: 560, minWidth: 320, minHeight: 340, maxWidth: 560, maxHeightRatio: 0.85 },
	search: { width: 360, height: 340, minWidth: 300, minHeight: 200, maxWidth: 480, maxHeightRatio: 0.7 },
	measure: { width: 280, height: 250, minWidth: 240, minHeight: 180, maxWidth: 380, maxHeightRatio: 0.55 },
	draw: { width: 300, height: 310, minWidth: 250, minHeight: 220, maxWidth: 420, maxHeightRatio: 0.62 },
	transect: { width: 320, height: 160, minWidth: 260, minHeight: 120, maxWidth: 420, maxHeightRatio: 0.45 },
	annotations: { width: 360, height: 420, minWidth: 300, minHeight: 250, maxWidth: 480, maxHeightRatio: 0.8 },
	swipe: { width: 300, height: 200, minWidth: 260, minHeight: 160, maxWidth: 400, maxHeightRatio: 0.5 },
	flood: { width: 320, height: 280, minWidth: 280, minHeight: 200, maxWidth: 420, maxHeightRatio: 0.55 },
	time: { width: 320, height: 180, minWidth: 260, minHeight: 140, maxWidth: 480, maxHeightRatio: 0.45 },
	export: { width: 620, height: 540, minWidth: 460, minHeight: 360, maxWidth: 980, maxHeightRatio: 0.88 },
}

interface MapToolRibbonProps {
	rasterRevision?: number
	getMapCanvas?: () => HTMLCanvasElement | null
	renderIssues?: string[]
	mapStyle: "dark" | "light"
	currentBasemap: string
	onBasemapChange: (id: string) => void
	hasMapboxToken?: boolean
	visibleLayerIds: Set<string>
	onVisibilityChange: (layerId: string, visible: boolean) => void
	onZoomToLayer?: (layer: MapLayer) => void
	layerOrder: string[]
	onReorder: (newOrder: string[]) => void
	layerCount: number
	measureMode?: "distance" | "area" | null
	onMeasureModeChange?: (mode: "distance" | "area" | null) => void
	drawMode?: "polygon" | "line" | "point" | null
	onDrawModeChange?: (mode: "polygon" | "line" | "point" | null) => void
	onFitExtent?: () => void
	searchOpen?: boolean
	onSearchToggle?: () => void
	galleryOpen?: boolean
	onGalleryToggle?: () => void
	exportOpen?: boolean
	onExportToggle?: () => void
	layerOpacities?: Record<string, number>
	onOpacityChange?: (layerId: string, opacity: number) => void
	clusterLayerIds?: Set<string>
	onClusterToggle?: (layerId: string, enabled: boolean) => void
	onShowAllLayers?: () => void
	onHideAllLayers?: () => void
	viewState?: MapViewState
	layers?: MapLayer[]
	/** Search UI rendered inside the Search ribbon panel */
	searchPanel?: React.ReactNode
	/** Annotations UI rendered inside the Annotations ribbon panel */
	annotationsPanel?: React.ReactNode
	/** Swipe UI rendered inside the Swipe ribbon panel */
	swipePanel?: React.ReactNode
	/** Transect tool active state */
	transectActive?: boolean
	onTransectToggle?: () => void
	/** Transect UI rendered inside the Transect ribbon panel */
	transectsPanel?: React.ReactNode
	/** Gallery UI rendered inside the Gallery ribbon panel */
	galleryPanel?: React.ReactNode
	/** Time slider UI rendered inside the Time ribbon panel */
	timeSliderPanel?: React.ReactNode
	/** Flood inundation stage scrubber */
	floodPanel?: React.ReactNode
	/** Claim ID this map state is bound to — shows a chip in the ribbon */
	boundClaimId?: string
}

interface RibbonButtonProps {
	/** Codicon name without prefix. */
	icon: string
	/** Accessible name and tooltip; always present. */
	label: string
	/** Visible text beside the icon when the ribbon is wide enough. */
	text?: string
	active: boolean
	accent: string
	onClick: () => void
	badge?: number
	disabled?: boolean
}

const RibbonButton: React.FC<RibbonButtonProps> = ({ icon, label, text, active, onClick, badge, disabled }) => (
	<button
		aria-label={label}
		aria-pressed={active}
		className={`map-ribbon-button${active ? " map-ribbon-button--active" : ""}${text ? " map-ribbon-button--labelled" : ""}`}
		disabled={disabled}
		onClick={onClick}
		title={label}
		type="button">
		<span aria-hidden="true" className={`codicon codicon-${icon}`} />
		{text && <span className="map-ribbon-button__text">{text}</span>}
		{badge !== undefined && <span className="map-ribbon-badge">{badge > 99 ? "99+" : badge}</span>}
	</button>
)

/** Wide enough to show text labels beside the ribbon icons (labels from 800 px). */
function useWideViewport(minWidth = 800): boolean {
	const [wide, setWide] = React.useState(() => typeof window !== "undefined" && window.innerWidth >= minWidth)
	React.useEffect(() => {
		const onResize = () => setWide(window.innerWidth >= minWidth)
		window.addEventListener("resize", onResize)
		return () => window.removeEventListener("resize", onResize)
	}, [minWidth])
	return wide
}

interface RibbonItem extends Omit<RibbonButtonProps, "accent" | "text"> {
	key: string
	/** Short visible label. */
	text: string
}
interface RibbonGroup {
	title: string
	items: RibbonItem[]
}

export const MapToolRibbon: React.FC<MapToolRibbonProps> = ({
	rasterRevision,
	getMapCanvas,
	renderIssues,
	mapStyle,
	currentBasemap,
	onBasemapChange,
	hasMapboxToken,
	visibleLayerIds,
	onVisibilityChange,
	onZoomToLayer,
	layerOrder,
	onReorder,
	layerCount,
	measureMode,
	onMeasureModeChange,
	drawMode,
	onDrawModeChange,
	onFitExtent,
	searchOpen,
	onSearchToggle,
	galleryOpen,
	onGalleryToggle,
	exportOpen,
	onExportToggle,
	layerOpacities,
	onOpacityChange,
	clusterLayerIds,
	onClusterToggle,
	onShowAllLayers,
	onHideAllLayers,
	viewState,
	layers,
	searchPanel,
	annotationsPanel,
	swipePanel,
	transectActive,
	onTransectToggle,
	transectsPanel,
	galleryPanel,
	timeSliderPanel,
	floodPanel,
	boundClaimId,
}) => {
	const persisted = loadMapWorkspace()
	const [active, setActive] = useState<RibbonTool>(null)
	const [panelWidth, setPanelWidth] = useState<number>(persisted.ribbonPanel?.width ?? 280)
	const [panelHeight, setPanelHeight] = useState<number>(persisted.ribbonPanel?.height ?? 380)

	useEffect(() => {
		saveMapWorkspace({ ribbonPanel: { width: panelWidth, height: panelHeight } })
	}, [panelWidth, panelHeight])

	useEffect(() => {
		if (searchOpen && active !== "search") {
			const size = TOOL_PANEL_SIZE.search
			setPanelWidth(size.width)
			setPanelHeight(size.height)
			setActive("search")
		}
	}, [searchOpen, active])

	useEffect(() => {
		if (galleryOpen && active !== "gallery") {
			const size = TOOL_PANEL_SIZE.gallery
			setPanelWidth(size.width)
			setPanelHeight(size.height)
			setActive("gallery")
		}
	}, [galleryOpen, active])

	const isDark = mapStyle === "dark"
	const fg = isDark ? "var(--vscode-foreground, #ddd)" : "var(--vscode-foreground, #222)"
	const bg = isDark ? "rgba(20,20,28,0.96)" : "rgba(248,248,250,0.97)"
	const border = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)"
	const subtle = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"
	const accent = "var(--vscode-button-background, #0e639c)"

	const clampPanelWidth = (width: number, tool: RibbonTool = active) => {
		const size = tool ? TOOL_PANEL_SIZE[tool] : TOOL_PANEL_SIZE.layers
		const max = Math.min(size.maxWidth, Math.max(size.minWidth, window.innerWidth - 120))
		const min = Math.min(size.minWidth, max)
		return Math.max(min, Math.min(max, width))
	}

	const clampPanelHeight = (height: number, tool: RibbonTool = active) => {
		const size = tool ? TOOL_PANEL_SIZE[tool] : TOOL_PANEL_SIZE.layers
		const max = Math.min(
			Math.round(window.innerHeight * size.maxHeightRatio),
			Math.max(size.minHeight, window.innerHeight - 48),
		)
		const min = Math.min(size.minHeight, max)
		return Math.max(min, Math.min(max, height))
	}

	const applyToolSize = (tool: Exclude<RibbonTool, null>) => {
		const size = TOOL_PANEL_SIZE[tool]
		setPanelWidth(clampPanelWidth(size.width, tool))
		setPanelHeight(clampPanelHeight(size.height, tool))
	}

	const toggle = (tool: RibbonTool) =>
		setActive((cur) => {
			if (cur === tool) {
				return null
			}
			if (tool) {
				applyToolSize(tool)
			}
			return tool
		})

	const onResizeWidthStart = (e: React.MouseEvent) => {
		e.preventDefault()
		const startX = e.clientX
		const startW = panelWidth
		const onMove = (ev: MouseEvent) => {
			const next = clampPanelWidth(startW + (startX - ev.clientX))
			setPanelWidth(next)
		}
		const onUp = () => {
			window.removeEventListener("mousemove", onMove)
			window.removeEventListener("mouseup", onUp)
		}
		window.addEventListener("mousemove", onMove)
		window.addEventListener("mouseup", onUp)
	}

	const onResizeHeightStart = (e: React.MouseEvent) => {
		e.preventDefault()
		const startY = e.clientY
		const startH = panelHeight
		const onMove = (ev: MouseEvent) => {
			const next = clampPanelHeight(startH + (ev.clientY - startY))
			setPanelHeight(next)
		}
		const onUp = () => {
			window.removeEventListener("mousemove", onMove)
			window.removeEventListener("mouseup", onUp)
		}
		window.addEventListener("mousemove", onMove)
		window.addEventListener("mouseup", onUp)
	}

	const showLabels = useWideViewport()
	const ribbonWidth = showLabels ? 188 : 44

	// Close panel handler — also clears measure mode / search / export when closing
	const closePanel = () => {
		if (active === "measure") {
			onMeasureModeChange?.(null)
		}
		if (active === "transect") {
			onTransectToggle?.()
		}
		if (active === "draw") {
			onDrawModeChange?.(null)
		}
		if (active === "search") {
			onSearchToggle?.()
		}
		if (active === "gallery") {
			onGalleryToggle?.()
		}
		if (active === "export") {
			onExportToggle?.()
		}
		setActive(null)
	}

	const ribbonGroups: RibbonGroup[] = [
		{
			title: "Layers & basemap",
			items: [
				{
					key: "basemap",
					icon: "globe",
					text: "Basemap",
					label: "Basemap",
					active: active === "basemap",
					onClick: () => toggle("basemap"),
				},
				{
					key: "layers",
					icon: "layers",
					text: "Layers",
					label: layerCount > 0 ? `Layer manager (${layerCount})` : "Layer manager",
					active: active === "layers",
					badge: layerCount > 0 ? layerCount : undefined,
					onClick: () => toggle("layers"),
				},
				{
					key: "gallery",
					icon: "compass",
					text: "Gallery",
					label: "Research Gallery",
					active: active === "gallery" || !!galleryOpen,
					onClick: () => {
						toggle("gallery")
						onGalleryToggle?.()
					},
				},
				{
					key: "hydrography",
					icon: "type-hierarchy",
					text: "Reference vectors",
					label: "Reference vectors (MERIT rivers, WBD HUCs)",
					active: active === "hydrography",
					onClick: () => toggle("hydrography"),
				},
			],
		},
		{
			title: "Navigate & search",
			items: [
				{
					key: "fit",
					icon: "screen-full",
					text: "Fit to layers",
					label: "Fit to layers",
					active: false,
					disabled: layerCount === 0,
					onClick: () => onFitExtent?.(),
				},
				{
					key: "search",
					icon: "search",
					text: "Search",
					label: "Search",
					active: active === "search" || !!searchOpen,
					onClick: () => {
						toggle("search")
						onSearchToggle?.()
					},
				},
			],
		},
		{
			title: "Measure & analyse",
			items: [
				{
					key: "draw",
					icon: "edit",
					text: "Draw",
					label: "Draw geometry",
					active: active === "draw",
					onClick: () => {
						onMeasureModeChange?.(null)
						if (active === "transect") {
							onTransectToggle?.()
						}
						toggle("draw")
					},
				},
				{
					key: "annotations",
					icon: "tag",
					text: "Annotations",
					label: "Smart annotations",
					active: active === "annotations",
					onClick: () => toggle("annotations"),
				},
				{
					key: "measure",
					icon: "symbol-ruler",
					text: "Measure",
					label: "Measure",
					active: active === "measure" || !!measureMode,
					onClick: () => {
						onDrawModeChange?.(null)
						toggle("measure")
					},
				},
				{
					key: "transect",
					icon: "graph-line",
					text: "Transect",
					label: "Transect profile",
					active: active === "transect" || !!transectActive,
					onClick: () => {
						onMeasureModeChange?.(null)
						onDrawModeChange?.(null)
						if (active !== "transect") {
							onTransectToggle?.()
						}
						toggle("transect")
					},
				},
				{
					key: "flood",
					icon: "pulse",
					text: "Flood",
					label: "Flood inundation — stage scrubber & 3D view",
					active: active === "flood",
					badge:
						layers?.filter(
							(l) =>
								l.metadata?.tool === "map_flood_inundation" ||
								l.metadata?.source === "HAND+SRC" ||
								l.metadata?.stage_lookup_json,
						).length || undefined,
					onClick: () => toggle("flood"),
				},
			],
		},
		{
			title: "Time & compare",
			items: [
				{
					key: "swipe",
					icon: "split-horizontal",
					text: "Swipe",
					label: "Swipe / Compare layers",
					active: active === "swipe",
					onClick: () => toggle("swipe"),
				},
				{
					key: "time",
					icon: "clock",
					text: "Time",
					label: "Time slider — filter layers by date range",
					active: active === "time",
					onClick: () => toggle("time"),
				},
			],
		},
		{
			title: "Export",
			items: [
				{
					key: "export",
					icon: "export",
					text: "Export",
					label: "Export snapshot",
					active: active === "export" || !!exportOpen,
					onClick: () => toggle("export"),
				},
			],
		},
	]

	return (
		<>
			{/* Tool panels — top-right, left of icon strip; kept narrow to avoid covering inspector */}
			{active && (
				<div
					className="map-ribbon-panel"
					style={{
						position: "absolute",
						top: 10,
						right: ribbonWidth + 8,
						zIndex: 4,
						width: clampPanelWidth(panelWidth, active),
						height: clampPanelHeight(panelHeight, active),
						minWidth: active ? TOOL_PANEL_SIZE[active].minWidth : 220,
						maxWidth: active ? TOOL_PANEL_SIZE[active].maxWidth : 520,
						maxHeight: active ? `${Math.round(TOOL_PANEL_SIZE[active].maxHeightRatio * 100)}vh` : "85vh",
						background: bg,
						color: fg,
						border: `1px solid ${border}`,
						borderRadius: 6,
						boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
						display: "flex",
						flexDirection: "column",
						overflow: "hidden",
						pointerEvents: "auto",
						fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
					}}>
					{/* Resize gripper on the left edge */}
					<div
						aria-label="Resize panel"
						onMouseDown={onResizeWidthStart}
						role="separator"
						style={{
							position: "absolute",
							left: 0,
							top: 0,
							bottom: 0,
							width: active === "export" ? 9 : 4,
							cursor: "ew-resize",
							zIndex: 1,
							background: active === "export" ? "rgba(255,255,255,0.08)" : "transparent",
						}}
						title="Drag left edge to resize"
					/>

					{/* Panel header */}
					<div
						style={{
							padding: "8px 10px 8px 12px",
							borderBottom: `1px solid ${border}`,
							display: "flex",
							alignItems: "center",
							gap: 8,
							background: subtle,
							flexShrink: 0,
						}}>
						<span style={{ fontSize: 14 }}>
							{active === "basemap"
								? "🗺️"
								: active === "layers"
									? "📑"
									: active === "gallery"
										? "🧭"
										: active === "search"
											? "🔍"
											: active === "measure"
												? "📏"
												: active === "draw"
													? "✏️"
													: active === "hydrography"
														? "🌊"
														: active === "flood"
															? "💧"
															: active === "export"
																? "🖼️"
																: ""}
						</span>
						<span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>
							{active === "basemap"
								? "Basemap"
								: active === "layers"
									? `Layers (${layerCount})`
									: active === "gallery"
										? "Research Gallery"
										: active === "search"
											? "Search"
											: active === "measure"
												? "Measure"
												: active === "draw"
													? "Create vector"
													: active === "hydrography"
														? "Reference vectors"
														: active === "flood"
															? "Flood inundation"
															: active === "export"
																? "Export"
																: ""}
						</span>
						{active === "export" && (
							<span style={{ fontSize: 10, opacity: 0.68, marginRight: 8 }}>
								Drag left or bottom edge to resize
							</span>
						)}
						<button
							aria-label="Close panel"
							onClick={closePanel}
							style={{
								background: "transparent",
								color: fg,
								border: "none",
								borderRadius: 3,
								padding: "2px 6px",
								cursor: "pointer",
								fontSize: 13,
								lineHeight: 1,
							}}
							title="Close"
							type="button">
							✕
						</button>
					</div>

					{/* Bottom edge — vertical resize */}
					<div
						aria-label="Resize panel height"
						onMouseDown={onResizeHeightStart}
						role="separator"
						style={{
							position: "absolute",
							left: 0,
							right: 0,
							bottom: 0,
							height: active === "export" ? 9 : 5,
							cursor: "ns-resize",
							zIndex: 1,
							background: active === "export" ? "rgba(255,255,255,0.08)" : "transparent",
						}}
						title="Drag bottom edge to resize height"
					/>

					{/* Panel content — scrollable */}
					<div className="map-ribbon-panel-content" style={{ overflowY: "auto", minHeight: 0, flex: 1 }}>
						{active === "basemap" && (
							<BasemapList
								currentStyle={currentBasemap}
								hasMapboxToken={hasMapboxToken}
								mapStyle={mapStyle}
								onStyleChange={onBasemapChange}
							/>
						)}
						{active === "layers" && (
							<LayerPanelContent
								clusterLayerIds={clusterLayerIds}
								layerOpacities={layerOpacities}
								layerOrder={layerOrder}
								mapStyle={mapStyle}
								onClusterToggle={onClusterToggle}
								onHideAllLayers={onHideAllLayers}
								onOpacityChange={onOpacityChange}
								onReorder={onReorder}
								onShowAllLayers={onShowAllLayers}
								onVisibilityChange={onVisibilityChange}
								onZoomToLayer={onZoomToLayer}
								visibleLayerIds={visibleLayerIds}
							/>
						)}
						{active === "search" && <div style={{ padding: 8 }}>{searchPanel}</div>}
						{active === "annotations" && <div style={{ padding: 8 }}>{annotationsPanel}</div>}
						{active === "swipe" && <div style={{ padding: 12 }}>{swipePanel}</div>}
						{active === "flood" && <div style={{ padding: 12 }}>{floodPanel}</div>}
						{active === "time" && <div style={{ padding: 12 }}>{timeSliderPanel}</div>}
						{active === "gallery" && (
							<div style={{ padding: 8 }}>
								{galleryPanel ?? (
									<ResearchGalleryPanel
										bookmarkedIds={[]}
										importCallbacks={{
											onImportScene: () => "Import unavailable here.",
											onImportTransects: () => "Import unavailable here.",
											onImportAnnotations: () => "Import unavailable here.",
										}}
										mapStyle={mapStyle}
										myItems={[]}
										onDeleteMyItem={() => {}}
										onOpenExport={() => toggle("export")}
										onSaveScene={() => {}}
										onToggleBookmark={() => {}}
										onUpdateMyItem={() => {}}
									/>
								)}
							</div>
						)}
						{active === "transect" && <div style={{ padding: 8 }}>{transectsPanel}</div>}
						{active === "measure" && (
							<div style={{ padding: 10 }}>
								<div style={{ fontSize: 11, opacity: 0.75, marginBottom: 8, lineHeight: 1.5 }}>
									Temporary distance or area measurements — not saved to the workspace.
								</div>
								<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
									<button
										onClick={() => onMeasureModeChange?.(measureMode === "distance" ? null : "distance")}
										style={{
											padding: "6px 10px",
											fontSize: 12,
											background:
												measureMode === "distance"
													? "var(--vscode-button-background, #0e639c)"
													: "transparent",
											color: fg,
											border: `1px solid ${border}`,
											borderRadius: 3,
											cursor: "pointer",
										}}>
										📏 Distance
									</button>
									<button
										onClick={() => onMeasureModeChange?.(measureMode === "area" ? null : "area")}
										style={{
											padding: "6px 10px",
											fontSize: 12,
											background:
												measureMode === "area"
													? "var(--vscode-button-background, #0e639c)"
													: "transparent",
											color: fg,
											border: `1px solid ${border}`,
											borderRadius: 3,
											cursor: "pointer",
										}}>
										📐 Area
									</button>
									{measureMode && (
										<div style={{ fontSize: 10, opacity: 0.7, marginTop: 4 }}>
											Click points on map. Double-click or Enter to finish. ESC to cancel.
										</div>
									)}
								</div>
							</div>
						)}
						{active === "draw" && (
							<div style={{ padding: 10 }}>
								<div style={{ fontSize: 11, opacity: 0.75, marginBottom: 8, lineHeight: 1.5 }}>
									Create vectors saved to <code style={{ fontSize: 10 }}>vectors/</code> in your workspace.
									After finishing, use Save or Export — geometry stays on screen until you choose.
								</div>
								<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
									<button
										onClick={() => {
											onMeasureModeChange?.(null)
											onDrawModeChange?.(drawMode === "polygon" ? null : "polygon")
										}}
										style={{
											padding: "6px 10px",
											fontSize: 12,
											background:
												drawMode === "polygon"
													? "var(--vscode-button-background, #2d9f6f)"
													: "transparent",
											color: fg,
											border: `1px solid ${border}`,
											borderRadius: 3,
											cursor: "pointer",
										}}
										type="button">
										⬡ Polygon
									</button>
									<button
										onClick={() => {
											onMeasureModeChange?.(null)
											onDrawModeChange?.(drawMode === "line" ? null : "line")
										}}
										style={{
											padding: "6px 10px",
											fontSize: 12,
											background:
												drawMode === "line" ? "var(--vscode-button-background, #2d9f6f)" : "transparent",
											color: fg,
											border: `1px solid ${border}`,
											borderRadius: 3,
											cursor: "pointer",
										}}
										type="button">
										〰 Line
									</button>
									<button
										onClick={() => {
											onMeasureModeChange?.(null)
											onDrawModeChange?.(drawMode === "point" ? null : "point")
										}}
										style={{
											padding: "6px 10px",
											fontSize: 12,
											background:
												drawMode === "point" ? "var(--vscode-button-background, #2d9f6f)" : "transparent",
											color: fg,
											border: `1px solid ${border}`,
											borderRadius: 3,
											cursor: "pointer",
										}}
										type="button">
										● Point
									</button>
								</div>
							</div>
						)}
						{active === "hydrography" && viewState && <HydrographyPanel mapStyle={mapStyle} viewState={viewState} />}
						{active === "export" && (
							<div style={{ padding: 10 }}>
								<MapExport
									currentBasemap={currentBasemap}
									getMapCanvas={getMapCanvas}
									layerOpacities={layerOpacities}
									layers={layers}
									mapStyle={mapStyle}
									onClose={() => toggle("export")}
									rasterRevision={rasterRevision}
									renderIssues={renderIssues}
									viewState={viewState}
									visibleLayerIds={visibleLayerIds}
								/>
							</div>
						)}
					</div>
				</div>
			)}

			{/* Bound-claim chip — floats above ribbon when set */}
			{boundClaimId && (
				<div
					style={{
						position: "absolute",
						top: 10,
						right: ribbonWidth + 14,
						zIndex: 5,
						background: "rgba(80,200,120,0.18)",
						border: "1px solid rgba(80,200,120,0.45)",
						borderRadius: 12,
						padding: "3px 9px",
						fontSize: 10,
						color: "var(--vscode-charts-green, #89d185)",
						pointerEvents: "none",
						whiteSpace: "nowrap",
					}}
					title={`Map state is linked to claim ${boundClaimId}`}>
					📎 {boundClaimId}
				</div>
			)}

			{/* Grouped ribbon: labelled at 800px and wider, icon-only (with aria-labels and tooltips) below */}
			<nav
				aria-label="Map tools"
				style={{
					position: "absolute",
					top: 10,
					right: 10,
					zIndex: 5,
					width: ribbonWidth,
					maxHeight: "calc(100% - 20px)",
					overflowY: "auto",
					background: bg,
					color: fg,
					border: `1px solid ${border}`,
					borderRadius: 6,
					boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
					display: "flex",
					flexDirection: "column",
					alignItems: "stretch",
					padding: "6px 0",
					gap: 4,
					pointerEvents: "auto",
					boxSizing: "border-box",
				}}>
				{ribbonGroups.map((group, index) => (
					<div
						aria-label={group.title}
						className="map-ribbon-group"
						key={group.title}
						role="group"
						style={{ borderTop: index === 0 ? "none" : `1px solid ${border}` }}>
						{showLabels && <div className="map-ribbon-group__title">{group.title}</div>}
						{group.items.map((item) => (
							<RibbonButton
								accent={accent}
								active={item.active}
								badge={item.badge}
								disabled={item.disabled}
								icon={item.icon}
								key={item.key}
								label={item.label}
								onClick={item.onClick}
								text={showLabels ? item.text : undefined}
							/>
						))}
					</div>
				))}
			</nav>
		</>
	)
}

export default MapToolRibbon
