/**
 * Map chrome layout: one place that decides how the tool rail and its panel sit around the canvas.
 *
 * Three chrome states (one control, persisted per user):
 *   collapsed  one 32 px "Map tools" button
 *   rail       a 40 px icon column
 *   hidden     only a 24 px edge tab; Ctrl/Cmd+. toggles it
 *
 * Panel placement follows the map's own width, never the window's:
 *   docked   >= 960 px  the panel and the rail take their own columns and the canvas shrinks by their width, so
 *                       nothing covers the map
 *   overlay  600-959    the panel floats over the canvas (the rail still has its own column)
 *   sheet    < 600      a bottom sheet; the rail is forced to collapsed
 *
 * The functions here are pure so the rules can be unit tested; `useMapChrome` wires them to the DOM.
 */

import { mapLayerToLiveLayer } from "@shared/map/liveLayer"
import type { MapLayer } from "@shared/proto/cline/map"
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { loadMapWorkspace, saveMapWorkspace } from "./mapWorkspace"

export type ChromeState = "collapsed" | "rail" | "hidden"
export type PanelMode = "docked" | "overlay" | "sheet"

export const RAIL_WIDTH = 40
export const COLLAPSED_SIZE = 32
export const EDGE_TAB_WIDTH = 24

/** Map widths at which the layout changes. */
export const DOCKED_MIN_WIDTH = 960
export const OVERLAY_MIN_WIDTH = 600
/** At this width and above the rail is the default state. */
export const RAIL_DEFAULT_MIN_WIDTH = 800

/** One panel width for every tool (per-tool sizes are gone). */
export const PANEL_WIDTH = { default: 300, min: 260, max: 380, maxShareOfMap: 0.4 } as const

export const SHEET_HEIGHT = { defaultPct: 55, minPct: 30, maxPct: 85 } as const

export function panelModeFor(mapWidth: number): PanelMode {
	if (mapWidth >= DOCKED_MIN_WIDTH) return "docked"
	if (mapWidth >= OVERLAY_MIN_WIDTH) return "overlay"
	return "sheet"
}

export function defaultChromeState(mapWidth: number): ChromeState {
	return mapWidth >= RAIL_DEFAULT_MIN_WIDTH ? "rail" : "collapsed"
}

/**
 * Panel width for a map of this width: 300 px, clamped to 260-380 px, and never more than 40% of the map. The 40%
 * cap wins over the 260 px floor, so a very narrow overlay does not swallow the map.
 */
export function panelWidthFor(mapWidth: number): number {
	const clamped = Math.max(PANEL_WIDTH.min, Math.min(PANEL_WIDTH.max, PANEL_WIDTH.default))
	return Math.max(0, Math.min(clamped, Math.floor(mapWidth * PANEL_WIDTH.maxShareOfMap)))
}

export interface ChromeLayout {
	state: ChromeState
	mode: PanelMode
	/** Width of the open panel in docked/overlay modes (0 for the sheet). */
	panelWidth: number
	/** Pixels the canvas gives up to the rail column (every mode, rail state only). */
	railReserve: number
	/** Pixels the canvas gives up to a docked panel. */
	dockReserve: number
	/** railReserve + dockReserve: how far the canvas stage is inset from the right edge. */
	stageInset: number
}

/**
 * The effective layout. `preference` is what the user chose (null: never chose, so the width decides). A sheet
 * forces the rail to collapsed, because a 40 px rail plus a full-width sheet leaves no room for either.
 * `panelOpen` is whether a tool panel is open; a hidden chrome shows no panel.
 */
export function layoutFor(mapWidth: number, preference: ChromeState | null, panelOpen: boolean): ChromeLayout {
	const mode = panelModeFor(mapWidth)
	let state = preference ?? defaultChromeState(mapWidth)
	if (state === "rail" && mode === "sheet") state = "collapsed"
	const showsPanel = panelOpen && state !== "hidden"
	const railReserve = state === "rail" ? RAIL_WIDTH : 0
	const panelWidth = mode === "sheet" ? 0 : panelWidthFor(mapWidth)
	const dockReserve = showsPanel && mode === "docked" ? panelWidth : 0
	return { state, mode, panelWidth, railReserve, dockReserve, stageInset: railReserve + dockReserve }
}

// ── conditional tools ───────────────────────────────────────────────────────

/** Layers the stage scrubber and 3D view act on. Mirrors what the old Flood badge counted. */
export function isFloodLayer(layer: MapLayer): boolean {
	return (
		layer.metadata?.tool === "map_flood_inundation" ||
		layer.metadata?.source === "HAND+SRC" ||
		Boolean(layer.metadata?.stage_lookup_json)
	)
}

export function hasTimeTaggedLayers(layers: MapLayer[]): boolean {
	return layers.some((layer) => Boolean(mapLayerToLiveLayer(layer).timeStart))
}

/**
 * Why a tool cannot open right now, or undefined when it can. Disabled tools stay in the More menu with this reason
 * as visible text, instead of opening an empty panel.
 */
export function toolDisabledReason(tool: "swipe" | "time" | "flood", layers: MapLayer[]): string | undefined {
	switch (tool) {
		case "swipe":
			return layers.length >= 1 ? undefined : "Needs a layer to compare with the basemap"
		case "time":
			return hasTimeTaggedLayers(layers) ? undefined : "No time-tagged layers"
		case "flood":
			return layers.some(isFloodLayer) ? undefined : "No flood layers"
	}
}

// ── persistence and the hook ────────────────────────────────────────────────

const isVisibleState = (v: unknown): v is "collapsed" | "rail" => v === "collapsed" || v === "rail"
export const isChromeState = (v: unknown): v is ChromeState => isVisibleState(v) || v === "hidden"

export interface MapChromeController extends ChromeLayout {
	/** Measured map width (the whole map, not the shrunken canvas). */
	width: number
	/** Sheet height as a share of the map, adjustable with the drag handle. */
	sheetHeightPct: number
	setSheetHeightPct: (pct: number) => void
	/** A user choice: persisted. */
	setState: (next: ChromeState) => void
	/** Ctrl/Cmd+. : hide, or restore what was showing before. */
	toggleHidden: () => void
}

/** The map's width, falling back to the window when nothing is laid out yet (tests, first paint). */
function useElementWidth(ref: RefObject<HTMLElement | null>): number {
	const read = () => {
		const measured = ref.current?.getBoundingClientRect().width ?? 0
		return measured > 0 ? measured : typeof window !== "undefined" ? window.innerWidth : 1024
	}
	const [width, setWidth] = useState<number>(read)
	useEffect(() => {
		const node = ref.current
		const update = () => setWidth(read())
		update()
		if (typeof ResizeObserver !== "undefined" && node) {
			const observer = new ResizeObserver(update)
			observer.observe(node)
			return () => observer.disconnect()
		}
		window.addEventListener("resize", update)
		return () => window.removeEventListener("resize", update)
		// biome-ignore lint/correctness/useExhaustiveDependencies: read() only closes over the ref
	}, [])
	return width
}

export function useMapChrome(containerRef: RefObject<HTMLElement | null>, panelOpen: boolean): MapChromeController {
	const width = useElementWidth(containerRef)
	const [preference, setPreference] = useState<ChromeState | null>(() => {
		const saved = loadMapWorkspace().chrome
		return isChromeState(saved) ? saved : null
	})
	// What to come back to from hidden. In memory first; persisted alongside so a reload keeps it.
	const restoreRef = useRef<"collapsed" | "rail" | null>(
		(() => {
			const saved = loadMapWorkspace().chromeRestore
			return isVisibleState(saved) ? saved : null
		})(),
	)
	const [sheetHeightPct, setSheetHeightPctRaw] = useState<number>(SHEET_HEIGHT.defaultPct)
	const setSheetHeightPct = useCallback(
		(pct: number) => setSheetHeightPctRaw(Math.round(Math.max(SHEET_HEIGHT.minPct, Math.min(SHEET_HEIGHT.maxPct, pct)))),
		[],
	)

	const layout = useMemo(() => layoutFor(width, preference, panelOpen), [width, preference, panelOpen])
	const layoutRef = useRef(layout)
	layoutRef.current = layout

	const setState = useCallback((next: ChromeState) => {
		const current = layoutRef.current.state
		if (next === "hidden" && current !== "hidden") {
			restoreRef.current = current
		}
		setPreference(next)
		saveMapWorkspace({ chrome: next, chromeRestore: restoreRef.current ?? undefined })
	}, [])

	const toggleHidden = useCallback(() => {
		if (layoutRef.current.state === "hidden") {
			setState(restoreRef.current ?? defaultChromeState(width))
		} else {
			setState("hidden")
		}
	}, [setState, width])

	// Ctrl/Cmd+. hides and restores the chrome (and with it the open panel, which comes back unchanged).
	const toggleRef = useRef(toggleHidden)
	toggleRef.current = toggleHidden
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "." && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
				e.preventDefault()
				toggleRef.current()
			}
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [])

	return { ...layout, width, sheetHeightPct, setSheetHeightPct, setState, toggleHidden }
}
