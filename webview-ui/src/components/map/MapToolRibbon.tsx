/**
 * MapToolRibbon — the map's tool chrome: a 40 px icon rail, the panel it opens, and the states around them.
 *
 *   rail       5 tools + More, and a chevron that collapses it
 *   collapsed  one 32 px "Map tools" button (the default below 800 px, and the only state in a bottom sheet)
 *   hidden     only a 24 px edge tab; Ctrl/Cmd+. toggles it
 *
 * The panel docks beside the canvas (>= 960 px, the canvas shrinks), floats over it (600-959 px) or becomes a bottom
 * sheet (< 600 px). Export and Gallery are centred modal sheets. Layout decisions live in mapChrome.ts; this file
 * renders them. MapView owns `activeTool` (one source of truth for which panel is open) and the chrome controller.
 *
 * Every rail item is a toggle (`aria-pressed`) and exactly one is pressed: the one that owns the open panel. The
 * rarely used tools sit in More as a labelled menu, and a tool that cannot act (Swipe with no layer, Time with no
 * time-tagged layer, Flood with no flood layer) stays in the menu, disabled, with the reason as visible text.
 */

import type { MapViewState } from "@deck.gl/core"
import type { MapLayer } from "@shared/proto/cline/map"
import React, { useCallback, useEffect, useId, useRef, useState } from "react"
import { BasemapList } from "./BaseMapSelector"
import HydrographyPanel from "./HydrographyPanel"
import { LayerPanelContent } from "./LayerPanel"
import MapExport from "./MapExport"
import { COLLAPSED_SIZE, EDGE_TAB_WIDTH, type MapChromeController, SHEET_HEIGHT, toolDisabledReason } from "./mapChrome"
import { MAP_Z } from "./mapZ"
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

type ToolId = Exclude<RibbonTool, null>
/** What a rail button stands for. Basemap and Reference are tabs of the Layers panel; the rest live in More. */
type RailId = "layers" | "search" | "annotations" | "measure" | "draw" | "more"

const TOOL_META: Record<ToolId, { icon: string; title: string }> = {
	layers: { icon: "layers", title: "Layers" },
	basemap: { icon: "globe", title: "Layers" },
	hydrography: { icon: "type-hierarchy", title: "Layers" },
	search: { icon: "search", title: "Search" },
	annotations: { icon: "pin", title: "Pins" },
	measure: { icon: "symbol-ruler", title: "Measure" },
	draw: { icon: "edit", title: "Create vector" },
	transect: { icon: "graph-line", title: "Transect profile" },
	swipe: { icon: "split-horizontal", title: "Swipe" },
	time: { icon: "clock", title: "Time slider" },
	flood: { icon: "pulse", title: "Flood inundation" },
	export: { icon: "export", title: "Export" },
	gallery: { icon: "compass", title: "Research Gallery" },
}

const RAIL_TOOLS: Exclude<RailId, "more">[] = ["layers", "search", "annotations", "measure", "draw"]
type MoreId = "transect" | "swipe" | "time" | "flood" | "export" | "gallery"
const MORE_TOOLS: MoreId[] = ["transect", "swipe", "time", "flood", "export", "gallery"]
/** Panels that are dialogs rather than sidebars: centred, with a scrim. */
const MODAL_TOOLS: ToolId[] = ["export", "gallery"]

const railOf = (tool: ToolId): RailId =>
	tool === "basemap" || tool === "hydrography" ? "layers" : (MORE_TOOLS as ToolId[]).includes(tool) ? "more" : (tool as RailId)

const LAYER_TABS: { tool: "layers" | "basemap" | "hydrography"; label: string; hint: string }[] = [
	{ tool: "layers", label: "Layers", hint: "Layers on the map" },
	{ tool: "basemap", label: "Basemap", hint: "Basemap" },
	{ tool: "hydrography", label: "Reference", hint: "Reference vectors (MERIT rivers, WBD HUCs)" },
]

const MORE_LABEL: Record<MoreId, { text: string; label: string }> = {
	transect: { text: "Transect", label: "Transect profile" },
	swipe: { text: "Swipe", label: "Swipe / Compare layers" },
	time: { text: "Time", label: "Time slider — filter layers by date range" },
	flood: { text: "Flood", label: "Flood inundation — stage scrubber & 3D view" },
	export: { text: "Export", label: "Export snapshot" },
	gallery: { text: "Gallery", label: "Research Gallery" },
}

interface MapToolRibbonProps {
	/** The chrome layout and state (mapChrome.ts `useMapChrome`). */
	chrome: MapChromeController
	rasterRevision?: number
	getMapCanvas?: () => HTMLCanvasElement | null
	renderIssues?: string[]
	mapStyle: "dark" | "light"
	currentBasemap: string
	onBasemapChange: (id: string) => void
	/** True when the current basemap was chosen by the user (not the hydrology default). */
	basemapExplicit?: boolean
	/** Clear the user's basemap choice and return to the hydrology default. */
	onBasemapReset?: () => void
	/**
	 * The open tool panel. MapView owns this so there is ONE source of truth for which panel is open (the
	 * empty state, Escape handling and the search/gallery/export/transect panels all derive from it).
	 * When omitted the ribbon keeps its own state.
	 */
	activeTool?: RibbonTool
	onActiveToolChange?: (tool: RibbonTool) => void
	visibleLayerIds: Set<string>
	onVisibilityChange: (layerId: string, visible: boolean) => void
	onZoomToLayer?: (layer: MapLayer) => void
	layerOrder: string[]
	onReorder: (newOrder: string[]) => void
	/** All layers the host holds. */
	layerCount: number
	/** Layers currently shown. The badge counts these; the tooltip gives "N visible · M hidden". */
	visibleLayerCount?: number
	measureMode?: "distance" | "area" | null
	onMeasureModeChange?: (mode: "distance" | "area" | null) => void
	drawMode?: "polygon" | "line" | "point" | null
	onDrawModeChange?: (mode: "polygon" | "line" | "point" | null) => void
	layerOpacities?: Record<string, number>
	onOpacityChange?: (layerId: string, opacity: number) => void
	clusterLayerIds?: Set<string>
	onClusterToggle?: (layerId: string, enabled: boolean) => void
	onShowAllLayers?: () => void
	onHideAllLayers?: () => void
	viewState?: MapViewState
	layers?: MapLayer[]
	/** Search UI rendered inside the Search panel */
	searchPanel?: React.ReactNode
	/** Pins UI rendered inside the Pins panel (today the Annotations panel; MP2 replaces it) */
	annotationsPanel?: React.ReactNode
	/** Swipe UI rendered inside the Swipe panel */
	swipePanel?: React.ReactNode
	/** Transect UI rendered inside the Transect panel */
	transectsPanel?: React.ReactNode
	/** Gallery UI rendered inside the Gallery sheet */
	galleryPanel?: React.ReactNode
	/** Time slider UI rendered inside the Time panel */
	timeSliderPanel?: React.ReactNode
	/** Flood inundation stage scrubber */
	floodPanel?: React.ReactNode
	/** Claim ID this map state is bound to — shows a chip beside the chrome */
	boundClaimId?: string
}

// ── menu ────────────────────────────────────────────────────────────────────

type MenuEntry =
	| {
			key: string
			icon: string
			text: string
			/** Accessible name; contains the visible text. */
			label: string
			/** Why the item cannot act right now. Shown as text and wired to aria-describedby. */
			reason?: string
			shortcut?: string
			current?: boolean
			onSelect: () => void
	  }
	| { key: string; divider: true }

/**
 * A labelled menu (More, and the tools list when the chrome is collapsed in a bottom sheet). Arrow keys, Home and
 * End move between items, Escape returns focus to the button that opened it, Tab or a click elsewhere closes it.
 * Disabled items stay focusable (`aria-disabled`) so a keyboard user can read the reason.
 */
const ToolMenu: React.FC<{
	label: string
	entries: MenuEntry[]
	triggerRef: React.RefObject<HTMLElement | null>
	onClose: (returnFocus: boolean) => void
	style?: React.CSSProperties
}> = ({ label, entries, triggerRef, onClose, style }) => {
	const menuRef = useRef<HTMLDivElement>(null)
	const baseId = useId()

	useEffect(() => {
		menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
	}, [])

	useEffect(() => {
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node
			if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
			onClose(false)
		}
		document.addEventListener("pointerdown", onPointerDown, true)
		return () => document.removeEventListener("pointerdown", onPointerDown, true)
	}, [onClose, triggerRef])

	const onKeyDown = (e: React.KeyboardEvent) => {
		const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
		const at = items.indexOf(document.activeElement as HTMLElement)
		const go = (i: number) => {
			e.preventDefault()
			items[(i + items.length) % items.length]?.focus()
		}
		if (e.key === "ArrowDown") go(at + 1)
		else if (e.key === "ArrowUp") go(at <= 0 ? items.length - 1 : at - 1)
		else if (e.key === "Home") go(0)
		else if (e.key === "End") go(items.length - 1)
		else if (e.key === "Escape") {
			e.preventDefault()
			e.stopPropagation()
			onClose(true)
		} else if (e.key === "Tab") onClose(false)
	}

	return (
		<div
			aria-label={label}
			className="map-chrome-menu"
			data-map-chrome="menu"
			onKeyDown={onKeyDown}
			ref={menuRef}
			role="menu"
			style={{ zIndex: MAP_Z.menu, ...style }}>
			{entries.map((entry) =>
				"divider" in entry ? (
					<div className="map-chrome-menu__divider" key={entry.key} role="separator" />
				) : (
					<button
						aria-current={entry.current ? "true" : undefined}
						aria-describedby={entry.reason ? `${baseId}-${entry.key}` : undefined}
						aria-disabled={entry.reason ? true : undefined}
						aria-label={entry.label}
						className={`map-chrome-menu__item${entry.current ? " map-chrome-menu__item--current" : ""}`}
						key={entry.key}
						onClick={() => {
							if (!entry.reason) entry.onSelect()
						}}
						role="menuitem"
						tabIndex={-1}
						title={entry.reason ? `${entry.label} — ${entry.reason}` : entry.label}
						type="button">
						<span aria-hidden="true" className={`codicon codicon-${entry.icon}`} />
						<span className="map-chrome-menu__text">
							<span>{entry.text}</span>
							{entry.reason && (
								<span className="map-chrome-menu__reason" id={`${baseId}-${entry.key}`}>
									{entry.reason}
								</span>
							)}
						</span>
						{entry.shortcut && <kbd className="map-chrome-menu__kbd">{entry.shortcut}</kbd>}
					</button>
				),
			)}
		</div>
	)
}

// ── buttons ────────────────────────────────────────────────────────────────

interface RailButtonProps {
	/** Codicon name without prefix. */
	icon: string
	/** Accessible name and tooltip; always present. */
	label: string
	active: boolean
	onClick: () => void
	badge?: number
	tool: string
	buttonRef?: React.Ref<HTMLButtonElement>
}

const RailButton: React.FC<RailButtonProps> = ({ icon, label, active, onClick, badge, tool, buttonRef }) => (
	<button
		aria-label={label}
		aria-pressed={active}
		className={`map-ribbon-button${active ? " map-ribbon-button--active" : ""}`}
		data-tool={tool}
		onClick={onClick}
		ref={buttonRef}
		title={label}
		type="button">
		<span aria-hidden="true" className={`codicon codicon-${icon}`} />
		{badge !== undefined && <span className="map-ribbon-badge">{badge > 99 ? "99+" : badge}</span>}
	</button>
)

// ── component ──────────────────────────────────────────────────────────────

export const MapToolRibbon: React.FC<MapToolRibbonProps> = ({
	chrome,
	rasterRevision,
	getMapCanvas,
	renderIssues,
	mapStyle,
	currentBasemap,
	onBasemapChange,
	basemapExplicit,
	onBasemapReset,
	activeTool,
	onActiveToolChange,
	visibleLayerIds,
	onVisibilityChange,
	onZoomToLayer,
	layerOrder,
	onReorder,
	layerCount,
	visibleLayerCount,
	measureMode,
	onMeasureModeChange,
	drawMode,
	onDrawModeChange,
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
	transectsPanel,
	galleryPanel,
	timeSliderPanel,
	floodPanel,
	boundClaimId,
}) => {
	const [internalActive, setInternalActive] = useState<RibbonTool>(null)
	const active: RibbonTool = activeTool !== undefined ? activeTool : internalActive
	const visibleCount = visibleLayerCount ?? layerCount
	const hiddenCount = Math.max(0, layerCount - visibleCount)
	const layerSummary = `${visibleCount} visible · ${hiddenCount} hidden`
	const allLayers = layers ?? []

	const { state, mode } = chrome
	const modal = active !== null && MODAL_TOOLS.includes(active)
	const panelVisible = active !== null && state !== "hidden"

	const bg = "var(--vscode-editorWidget-background, var(--vscode-editor-background, #1f1f1f))"
	const border = "var(--vscode-contrastBorder, var(--vscode-editorWidget-border, rgba(128,128,128,0.35)))"
	const fg = "var(--vscode-foreground, #ddd)"

	/**
	 * The one way a panel opens or closes. Leaving a tool ends its map mode (measure / draw), so a tool is never
	 * left running behind another panel and two rail items are never lit at once.
	 */
	const changeTool = (next: RibbonTool) => {
		if (next === active) {
			return
		}
		if (active === "measure") {
			onMeasureModeChange?.(null)
		}
		if (active === "draw") {
			onDrawModeChange?.(null)
		}
		if (activeTool === undefined) {
			setInternalActive(next)
		}
		onActiveToolChange?.(next)
	}
	const toggle = (tool: ToolId) => changeTool(active === tool ? null : tool)

	// ── focus management ──
	const navRef = useRef<HTMLElement>(null)
	const mapToolsRef = useRef<HTMLButtonElement>(null)
	const moreRef = useRef<HTMLButtonElement>(null)
	const edgeTabRef = useRef<HTMLButtonElement>(null)
	const pendingFocus = useRef<"button" | "rail" | null>(null)
	useEffect(() => {
		const want = pendingFocus.current
		pendingFocus.current = null
		if (want === "button") mapToolsRef.current?.focus()
		else if (want === "rail") navRef.current?.querySelector<HTMLElement>("[data-tool]")?.focus()
	}, [state])
	// Hiding unmounts the rail and panel; if focus was in them it would fall to the body, so it moves to the edge tab.
	const prevState = useRef(state)
	useEffect(() => {
		const was = prevState.current
		prevState.current = state
		if (state !== "hidden" || was === "hidden") {
			return
		}
		const el = document.activeElement
		if (!el || el === document.body) {
			edgeTabRef.current?.focus()
		}
	}, [state])
	const focusLater = (el: () => HTMLElement | null | undefined) => setTimeout(() => el()?.focus(), 0)
	const focusRailTool = (tool: ToolId) =>
		focusLater(() => navRef.current?.querySelector<HTMLElement>(`[data-tool="${railOf(tool)}"]`) ?? mapToolsRef.current)

	const closePanel = (returnFocus = false) => {
		const was = active
		changeTool(null)
		if (returnFocus && was) focusRailTool(was)
	}

	const [moreOpen, setMoreOpen] = useState(false)
	const [toolsMenuOpen, setToolsMenuOpen] = useState(false)
	const closeMore = useCallback((returnFocus: boolean) => {
		setMoreOpen(false)
		if (returnFocus) focusLater(() => moreRef.current)
	}, [])
	const closeToolsMenu = useCallback((returnFocus: boolean) => {
		setToolsMenuOpen(false)
		if (returnFocus) focusLater(() => mapToolsRef.current)
	}, [])
	// A menu belongs to the chrome that opened it.
	useEffect(() => {
		setMoreOpen(false)
		setToolsMenuOpen(false)
	}, [state, mode])

	const moreActive = active !== null && railOf(active) === "more"
	const reasonFor = (tool: ToolId) =>
		tool === "swipe" || tool === "time" || tool === "flood" ? toolDisabledReason(tool, allLayers) : undefined

	const moreEntries = (afterSelect: () => void, withHide: boolean): MenuEntry[] => [
		...MORE_TOOLS.map((tool): MenuEntry => {
			const meta = MORE_LABEL[tool]
			return {
				key: tool,
				icon: TOOL_META[tool].icon,
				text: meta.text,
				label: meta.label,
				reason: reasonFor(tool),
				current: active === tool,
				onSelect: () => {
					afterSelect()
					toggle(tool)
				},
			}
		}),
		...(withHide
			? ([
					{ key: "div-hide", divider: true },
					{
						key: "hide",
						icon: "layout-sidebar-right-off",
						text: "Hide map tools",
						label: "Hide map tools",
						shortcut: "Ctrl+.",
						onSelect: () => {
							afterSelect()
							chrome.setState("hidden")
						},
					},
				] as MenuEntry[])
			: []),
	]

	/** Every tool, for the collapsed button's menu where there is no room for a rail (bottom sheet). */
	const allToolEntries = (): MenuEntry[] => [
		...RAIL_TOOLS.map((id): MenuEntry => {
			const label =
				id === "layers"
					? "Layer manager"
					: id === "annotations"
						? "Pins"
						: id === "draw"
							? "Draw ROI"
							: TOOL_META[id].title
			return {
				key: id,
				icon: TOOL_META[id].icon,
				text: TOOL_META[id].title === "Create vector" ? "Draw ROI" : TOOL_META[id].title,
				label,
				current: active !== null && railOf(active) === id,
				onSelect: () => {
					setToolsMenuOpen(false)
					toggle(id)
				},
			}
		}),
		{ key: "div", divider: true },
		...moreEntries(() => setToolsMenuOpen(false), true),
	]

	// ── sheet drag handle ──
	const sheetRef = useRef<HTMLElement>(null)
	const onHandlePointerDown = (e: React.PointerEvent) => {
		e.preventDefault()
		const parent = sheetRef.current?.parentElement
		if (!parent) return
		const rect = parent.getBoundingClientRect()
		const onMove = (ev: PointerEvent) => chrome.setSheetHeightPct(((rect.bottom - ev.clientY) / rect.height) * 100)
		const onUp = () => {
			window.removeEventListener("pointermove", onMove)
			window.removeEventListener("pointerup", onUp)
		}
		window.addEventListener("pointermove", onMove)
		window.addEventListener("pointerup", onUp)
	}
	const onHandleKeyDown = (e: React.KeyboardEvent) => {
		const step = e.key === "ArrowUp" ? 5 : e.key === "ArrowDown" ? -5 : 0
		if (step) {
			e.preventDefault()
			chrome.setSheetHeightPct(chrome.sheetHeightPct + step)
		} else if (e.key === "Home") {
			e.preventDefault()
			chrome.setSheetHeightPct(SHEET_HEIGHT.maxPct)
		} else if (e.key === "End") {
			e.preventDefault()
			chrome.setSheetHeightPct(SHEET_HEIGHT.minPct)
		}
	}

	// ── panel pieces ──
	const family: ToolId | null = active === "basemap" || active === "hydrography" ? "layers" : active
	const title = family === null ? "" : family === "layers" ? `Layers (${layerSummary})` : TOOL_META[family].title

	const toggleBtn = (pressed: boolean, activeColor: string): React.CSSProperties => ({
		padding: "6px 10px",
		fontSize: 12,
		background: pressed ? activeColor : "transparent",
		color: pressed ? "var(--vscode-button-foreground, #fff)" : fg,
		border: `1px solid ${border}`,
		borderRadius: 3,
		cursor: "pointer",
		display: "flex",
		alignItems: "center",
		gap: 6,
		textAlign: "left",
	})
	const modeButton = (icon: string, text: string, pressed: boolean, activeColor: string, onClick: () => void) => (
		<button aria-pressed={pressed} onClick={onClick} style={toggleBtn(pressed, activeColor)} type="button">
			<span aria-hidden="true" className={`codicon codicon-${icon}`} />
			{text}
		</button>
	)

	const layerTabs = (
		<div aria-label="Layer tools" className="map-chrome-tabs" role="tablist" style={{ borderBottom: `1px solid ${border}` }}>
			{LAYER_TABS.map((tab, index) => {
				const selected = (active ?? "layers") === tab.tool
				return (
					<button
						aria-controls="map-chrome-layers-tabpanel"
						aria-selected={selected}
						className={`map-chrome-tab${selected ? " map-chrome-tab--selected" : ""}`}
						id={`map-chrome-tab-${tab.tool}`}
						key={tab.tool}
						onClick={() => changeTool(tab.tool)}
						onKeyDown={(e) => {
							const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0
							if (!delta) return
							e.preventDefault()
							const next = LAYER_TABS[(index + delta + LAYER_TABS.length) % LAYER_TABS.length]
							changeTool(next.tool)
							focusLater(() => document.getElementById(`map-chrome-tab-${next.tool}`))
						}}
						role="tab"
						tabIndex={selected ? 0 : -1}
						title={tab.hint}
						type="button">
						{tab.label}
					</button>
				)
			})}
		</div>
	)

	const exportBody = (
		<div style={{ padding: 10 }}>
			<MapExport
				currentBasemap={currentBasemap}
				getMapCanvas={getMapCanvas}
				layerOpacities={layerOpacities}
				layers={layers}
				mapStyle={mapStyle}
				onClose={() => closePanel(true)}
				rasterRevision={rasterRevision}
				renderIssues={renderIssues}
				viewState={viewState}
				visibleLayerIds={visibleLayerIds}
			/>
		</div>
	)

	const galleryBody = (
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
					onOpenExport={() => changeTool("export")}
					onSaveScene={() => {}}
					onToggleBookmark={() => {}}
					onUpdateMyItem={() => {}}
				/>
			)}
		</div>
	)

	const panelBody = (
		<>
			{(active === "layers" || active === "basemap" || active === "hydrography") && (
				<>
					{layerTabs}
					<div
						aria-labelledby={`map-chrome-tab-${active}`}
						id="map-chrome-layers-tabpanel"
						role="tabpanel"
						tabIndex={-1}>
						{active === "basemap" && (
							<BasemapList
								currentStyle={currentBasemap}
								explicit={basemapExplicit}
								mapStyle={mapStyle}
								onResetToDefault={onBasemapReset}
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
						{active === "hydrography" && viewState && <HydrographyPanel mapStyle={mapStyle} viewState={viewState} />}
					</div>
				</>
			)}
			{active === "search" && <div style={{ padding: 8 }}>{searchPanel}</div>}
			{active === "annotations" && <div style={{ padding: 8 }}>{annotationsPanel}</div>}
			{active === "swipe" && <div style={{ padding: 12 }}>{swipePanel}</div>}
			{active === "flood" && <div style={{ padding: 12 }}>{floodPanel}</div>}
			{active === "time" && <div style={{ padding: 12 }}>{timeSliderPanel}</div>}
			{active === "transect" && <div style={{ padding: 8 }}>{transectsPanel}</div>}
			{active === "measure" && (
				<div style={{ padding: 10 }}>
					<div style={{ fontSize: 11, opacity: 0.75, marginBottom: 8, lineHeight: 1.5 }}>
						Temporary distance or area measurements — not saved to the workspace.
					</div>
					<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
						{modeButton(
							"symbol-ruler",
							"Distance",
							measureMode === "distance",
							"var(--vscode-button-background, #0e639c)",
							() => onMeasureModeChange?.(measureMode === "distance" ? null : "distance"),
						)}
						{modeButton(
							"symbol-array",
							"Area",
							measureMode === "area",
							"var(--vscode-button-background, #0e639c)",
							() => onMeasureModeChange?.(measureMode === "area" ? null : "area"),
						)}
						{measureMode && (
							<div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>
								Click points on map. Double-click or Enter to finish. ESC to cancel.
							</div>
						)}
					</div>
				</div>
			)}
			{active === "draw" && (
				<div style={{ padding: 10 }}>
					<div style={{ fontSize: 11, opacity: 0.75, marginBottom: 8, lineHeight: 1.5 }}>
						Create vectors saved to <code style={{ fontSize: 11 }}>vectors/</code> in your workspace. After finishing,
						use Save or Export — geometry stays on screen until you choose.
					</div>
					<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
						{(
							[
								["polygon", "symbol-field", "Polygon"],
								["line", "graph-line", "Line"],
								["point", "circle-filled", "Point"],
							] as const
						).map(([kind, icon, text]) => (
							<React.Fragment key={kind}>
								{modeButton(icon, text, drawMode === kind, "var(--vscode-button-background, #2d9f6f)", () => {
									onMeasureModeChange?.(null)
									onDrawModeChange?.(drawMode === kind ? null : kind)
								})}
							</React.Fragment>
						))}
					</div>
				</div>
			)}
		</>
	)

	const header = (id: string, icon: string, text: string) => (
		<div
			style={{
				padding: "6px 8px 6px 12px",
				borderBottom: `1px solid ${border}`,
				display: "flex",
				alignItems: "center",
				gap: 8,
				flexShrink: 0,
			}}>
			<span aria-hidden="true" className={`codicon codicon-${icon}`} />
			<h2
				id={id}
				style={{
					fontWeight: 600,
					fontSize: 13,
					flex: 1,
					margin: 0,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}>
				{text}
			</h2>
			<button
				aria-label="Close panel"
				className="map-chrome-close"
				onClick={() => closePanel(true)}
				title="Close"
				type="button">
				<span aria-hidden="true" className="codicon codicon-close" />
			</button>
		</div>
	)

	// ── modal sheet (Export, Gallery) ──
	const dialogRef = useRef<HTMLDivElement>(null)
	const modalOpen = modal && panelVisible
	useEffect(() => {
		if (!modalOpen) return
		const returnTo = (document.activeElement as HTMLElement | null) ?? null
		dialogRef.current?.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]")?.focus()
		return () => {
			// Focus goes back to what opened the dialog; if that was a menu item that is gone, to the More button.
			const target = returnTo && document.contains(returnTo) && returnTo !== document.body ? returnTo : moreRef.current
			setTimeout(() => (target ?? mapToolsRef.current)?.focus(), 0)
		}
	}, [modalOpen])
	const onDialogKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault()
			e.stopPropagation()
			changeTool(null)
			return
		}
		if (e.key !== "Tab") return
		const focusable = Array.from(
			dialogRef.current?.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
			) ?? [],
		).filter((el) => el.getClientRects().length > 0)
		if (focusable.length === 0) return
		const first = focusable[0]
		const last = focusable[focusable.length - 1]
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault()
			last.focus()
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault()
			first.focus()
		}
	}

	// ── placement ──
	const panelShell: React.CSSProperties = {
		position: "absolute",
		zIndex: MAP_Z.panel,
		background: bg,
		color: fg,
		display: "flex",
		flexDirection: "column",
		overflow: "hidden",
		pointerEvents: "auto",
		fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
		boxSizing: "border-box",
	}
	const panelStyle: React.CSSProperties =
		mode === "docked"
			? {
					...panelShell,
					top: 0,
					bottom: 0,
					right: chrome.railReserve,
					width: chrome.panelWidth,
					borderLeft: `1px solid ${border}`,
				}
			: mode === "overlay"
				? {
						...panelShell,
						top: 8,
						right: chrome.railReserve + 8,
						width: chrome.panelWidth,
						maxHeight: "min(560px, calc(100% - 16px))",
						border: `1px solid ${border}`,
						borderRadius: 6,
						boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
					}
				: {
						...panelShell,
						left: 0,
						right: 0,
						bottom: 0,
						height: `${chrome.sheetHeightPct}%`,
						borderTop: `1px solid ${border}`,
						borderRadius: "10px 10px 0 0",
						boxShadow: "0 -4px 20px rgba(0,0,0,0.35)",
					}

	// The collapsed button and edge tab sit at the canvas corner, clear of a docked or floating panel.
	const cornerRight = chrome.stageInset + (mode === "overlay" && panelVisible && !modal ? chrome.panelWidth + 8 : 0) + 8
	const activeMeta = active ? TOOL_META[active] : null
	const activeName = active
		? active === "layers" || active === "basemap" || active === "hydrography"
			? "Layers"
			: TOOL_META[active].title
		: null

	return (
		<div
			data-map-chrome-mode={mode}
			data-map-chrome-root=""
			data-map-chrome-state={state}
			data-map-panel-open={panelVisible && !modal ? "true" : "false"}
			style={{ display: "contents" }}>
			{/* Tool panel: docked column, floating panel or bottom sheet */}
			{panelVisible && !modal && active && (
				<section
					aria-labelledby="map-chrome-panel-title"
					className="map-ribbon-panel"
					data-map-chrome="panel"
					data-map-panel={family ?? ""}
					onKeyDown={(e) => {
						const tag = (e.target as HTMLElement).tagName
						if (e.key === "Escape" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
							e.stopPropagation()
							closePanel(true)
						}
					}}
					ref={sheetRef}
					style={panelStyle}>
					{mode === "sheet" && (
						<div
							aria-label="Resize sheet"
							aria-orientation="horizontal"
							aria-valuemax={SHEET_HEIGHT.maxPct}
							aria-valuemin={SHEET_HEIGHT.minPct}
							aria-valuenow={chrome.sheetHeightPct}
							aria-valuetext={`${chrome.sheetHeightPct}% of the map`}
							className="map-chrome-handle"
							onKeyDown={onHandleKeyDown}
							onPointerDown={onHandlePointerDown}
							role="separator"
							tabIndex={0}>
							<span className="map-chrome-handle__grip" />
						</div>
					)}
					{header("map-chrome-panel-title", activeMeta?.icon ?? "layers", title)}
					<div className="map-ribbon-panel-content" style={{ overflowY: "auto", minHeight: 0, flex: 1 }}>
						{panelBody}
					</div>
				</section>
			)}

			{/* Export and Gallery: a centred dialog over a scrim */}
			{modalOpen && active && (
				<div
					className="map-chrome-scrim"
					data-map-chrome="modal"
					onMouseDown={(e) => {
						if (e.target === e.currentTarget) changeTool(null)
					}}
					style={{ zIndex: MAP_Z.modal }}>
					<div
						aria-labelledby="map-chrome-dialog-title"
						aria-modal="true"
						className="map-chrome-dialog"
						onKeyDown={onDialogKeyDown}
						ref={dialogRef}
						role="dialog"
						style={{ background: bg, color: fg, border: `1px solid ${border}` }}>
						{header("map-chrome-dialog-title", TOOL_META[active].icon, TOOL_META[active].title)}
						<div style={{ overflowY: "auto", minHeight: 0, flex: 1 }}>
							{active === "export" ? exportBody : galleryBody}
						</div>
					</div>
				</div>
			)}

			{/* Bound-claim chip */}
			{boundClaimId && state !== "hidden" && (
				<div
					className="map-chrome-claim"
					style={{
						top: 12,
						right: cornerRight + (state === "collapsed" ? COLLAPSED_SIZE + 6 : 6),
						zIndex: MAP_Z.panel,
					}}
					title={`Map state is linked to claim ${boundClaimId}`}>
					<span aria-hidden="true" className="codicon codicon-link" /> {boundClaimId}
				</div>
			)}

			{/* Rail */}
			{state === "rail" && (
				<nav
					aria-label="Map tools"
					className="map-chrome-rail"
					data-map-chrome="rail"
					ref={navRef}
					style={{ zIndex: MAP_Z.panel, background: bg, color: fg, borderLeft: `1px solid ${border}` }}>
					<div aria-label="View tools" className="map-chrome-rail__group" role="group">
						<RailButton
							active={!!active && railOf(active) === "layers"}
							badge={layerCount > 0 ? visibleCount : undefined}
							icon="layers"
							label={layerCount > 0 ? `Layer manager (${layerSummary})` : "Layer manager"}
							onClick={() => toggle(active === "basemap" || active === "hydrography" ? active : "layers")}
							tool="layers"
						/>
						<RailButton
							active={active === "search"}
							icon="search"
							label="Search"
							onClick={() => toggle("search")}
							tool="search"
						/>
					</div>
					<div aria-label="Work tools" className="map-chrome-rail__group" role="group">
						<RailButton
							active={active === "annotations"}
							icon="pin"
							label="Pins"
							onClick={() => toggle("annotations")}
							tool="annotations"
						/>
						<RailButton
							active={active === "measure"}
							icon="symbol-ruler"
							label="Measure"
							onClick={() => toggle("measure")}
							tool="measure"
						/>
						<RailButton
							active={active === "draw"}
							icon="edit"
							label="Draw ROI"
							onClick={() => toggle("draw")}
							tool="draw"
						/>
					</div>
					<div aria-label="More tools" className="map-chrome-rail__group" role="group" style={{ position: "relative" }}>
						<RailButton
							active={moreActive}
							buttonRef={moreRef}
							icon="ellipsis"
							label="More tools"
							onClick={() => setMoreOpen((v) => !v)}
							tool="more"
						/>
						{moreOpen && (
							<ToolMenu
								entries={moreEntries(() => setMoreOpen(false), true)}
								label="More tools"
								onClose={closeMore}
								style={{ position: "absolute", right: "calc(100% + 4px)", top: 0 }}
								triggerRef={moreRef}
							/>
						)}
					</div>
					<button
						aria-expanded={true}
						aria-label="Collapse map tools"
						className="map-ribbon-button map-chrome-rail__collapse"
						onClick={() => {
							pendingFocus.current = "button"
							chrome.setState("collapsed")
						}}
						title="Collapse map tools"
						type="button">
						<span aria-hidden="true" className="codicon codicon-chevron-right" />
					</button>
				</nav>
			)}

			{/* Collapsed: one button. In a bottom sheet there is no room for a rail, so it opens a tools menu. */}
			{state === "collapsed" && (
				<div className="map-chrome-corner" style={{ top: 8, right: cornerRight, zIndex: MAP_Z.panel }}>
					<button
						aria-expanded={mode === "sheet" ? toolsMenuOpen : false}
						aria-haspopup={mode === "sheet" ? "menu" : undefined}
						aria-label={activeName ? `Map tools, ${activeName} open` : "Map tools"}
						className={`map-ribbon-button map-chrome-collapsed${activeName ? " map-ribbon-button--active" : ""}`}
						data-map-chrome="button"
						onClick={() => {
							if (mode === "sheet") {
								setToolsMenuOpen((v) => !v)
							} else {
								pendingFocus.current = "rail"
								chrome.setState("rail")
							}
						}}
						ref={mapToolsRef}
						style={{ background: bg, borderColor: border, width: COLLAPSED_SIZE, height: COLLAPSED_SIZE }}
						title="Map tools"
						type="button">
						<span aria-hidden="true" className="codicon codicon-tools" />
						{activeMeta && (
							<span aria-hidden="true" className={`map-chrome-activebadge codicon codicon-${activeMeta.icon}`} />
						)}
					</button>
					{toolsMenuOpen && (
						<ToolMenu
							entries={allToolEntries()}
							label="Map tools"
							onClose={closeToolsMenu}
							style={{ position: "absolute", right: 0, top: COLLAPSED_SIZE + 4 }}
							triggerRef={mapToolsRef}
						/>
					)}
				</div>
			)}

			{/* Hidden: an edge tab brings the chrome back (one click lands on Collapsed) */}
			{state === "hidden" && (
				<button
					aria-label="Show map tools (Ctrl+.)"
					className="map-chrome-edgetab"
					data-map-chrome="tab"
					onClick={() => {
						pendingFocus.current = "button"
						chrome.setState("collapsed")
					}}
					ref={edgeTabRef}
					style={{ zIndex: MAP_Z.panel, width: EDGE_TAB_WIDTH, background: bg, color: fg, borderColor: border }}
					title="Show map tools (Ctrl+.)"
					type="button">
					<span aria-hidden="true" className="codicon codicon-chevron-left" />
				</button>
			)}
		</div>
	)
}

export default MapToolRibbon
