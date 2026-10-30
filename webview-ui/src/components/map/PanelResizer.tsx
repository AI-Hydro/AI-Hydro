/**
 * PanelResizer: the one resize behaviour every map tool panel shares.
 *
 *   docked   a separator on the panel's left edge changes the column width
 *   overlay  edges and corners change width, height and position (the opposite edge stays put)
 *   sheet    a separator on the top edge changes the height (the existing drag handle, now remembered)
 *
 * While the pointer is down the panel element is resized directly (`style`), so React and the map do not re-render per
 * pixel; the size is committed once on release, which is when a docked panel's canvas gives up or takes back its
 * width. Keyboard: with an edge separator focused, the arrow keys move the edge (16 px, 64 px with Shift), Home and End
 * go to the smallest and largest size. Double-click a separator to restore the default size.
 *
 * Sizes are remembered per panel and per window state (panelSizes.ts); limits live there.
 */

import React, { type RefObject, useCallback, useRef } from "react"
import { type MapChromeController, SHEET_HEIGHT } from "./mapChrome"
import { MAP_Z } from "./mapZ"
import {
	type Area,
	clampDockedWidth,
	clampOverlay,
	clampSheetPct,
	dockedLimits,
	keyDelta,
	type OverlayRect,
	overlayHeightLimits,
	overlayWidthLimits,
	type ResizeHandle,
	resizeOverlay,
} from "./panelSizes"

interface PanelResizerProps {
	chrome: MapChromeController
	panelRef: RefObject<HTMLElement | null>
	/** The panel's name, for the separators' accessible names. */
	name: string
}

const OVERLAY_HANDLES: ResizeHandle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"]
/** Edges that take the keyboard; the rest (top, right, corners) are pointer-only to keep the tab order short. */
const FOCUSABLE: ResizeHandle[] = ["w", "s"]

const cursorFor = (h: ResizeHandle) =>
	h === "n" || h === "s"
		? "ns-resize"
		: h === "e" || h === "w"
			? "ew-resize"
			: h === "ne" || h === "sw"
				? "nesw-resize"
				: "nwse-resize"

export const PanelResizer: React.FC<PanelResizerProps> = ({ chrome, panelRef, name }) => {
	const { mode } = chrome
	const dragging = useRef(false)

	const area: Area = { width: chrome.width - chrome.railReserve, height: chrome.height }
	const overlay = chrome.overlay

	/** Run a pointer drag: `apply` styles the panel for the pointer's offset and returns what to commit on release. */
	const drag = useCallback(
		(
			e: React.PointerEvent<HTMLElement>,
			apply: (dx: number, dy: number, at: { x: number; y: number }) => (() => void) | undefined,
		) => {
			if (e.button !== 0) return
			e.preventDefault()
			const target = e.currentTarget
			const startX = e.clientX
			const startY = e.clientY
			dragging.current = true
			target.setPointerCapture?.(e.pointerId)
			target.dataset.dragging = "true"
			let commit: (() => void) | undefined
			const onMove = (ev: PointerEvent) => {
				commit = apply(ev.clientX - startX, ev.clientY - startY, { x: ev.clientX, y: ev.clientY })
			}
			const onUp = () => {
				target.removeEventListener("pointermove", onMove)
				target.removeEventListener("pointerup", onUp)
				target.removeEventListener("pointercancel", onUp)
				delete target.dataset.dragging
				dragging.current = false
				commit?.()
			}
			target.addEventListener("pointermove", onMove)
			target.addEventListener("pointerup", onUp)
			target.addEventListener("pointercancel", onUp)
		},
		[],
	)

	const onDockedDown = (e: React.PointerEvent<HTMLElement>) => {
		const panel = panelRef.current
		if (!panel) return
		const start = panel.getBoundingClientRect().width
		drag(e, (dx) => {
			// The panel is anchored on the right, so dragging its left edge left (negative dx) widens it.
			const width = clampDockedWidth(start - dx, chrome.width, chrome.railReserve)
			panel.style.width = `${width}px`
			return () => chrome.setPanelSize({ docked: { width } })
		})
	}

	const onOverlayDown = (handle: ResizeHandle) => (e: React.PointerEvent<HTMLElement>) => {
		const panel = panelRef.current
		if (!panel || !overlay) return
		const start = { ...overlay, height: panel.getBoundingClientRect().height }
		drag(e, (dx, dy) => {
			const next = resizeOverlay(start, handle, dx, dy, area)
			applyOverlay(panel, next, chrome.railReserve)
			return () =>
				chrome.setPanelSize({
					overlay: { width: next.width, height: next.height ?? start.height, right: next.right, top: next.top },
				})
		})
	}

	const onSheetDown = (e: React.PointerEvent<HTMLElement>) => {
		const panel = panelRef.current
		const parent = panel?.parentElement
		if (!panel || !parent) return
		const rect = parent.getBoundingClientRect()
		drag(e, (_dx, _dy, at) => {
			// The sheet's top edge follows the pointer; height is the share of the map below it.
			const pct = clampSheetPct(((rect.bottom - at.y) / rect.height) * 100)
			panel.style.height = `${pct}%`
			return () => chrome.setSheetHeightPct(pct)
		})
	}

	// ── keyboard ──
	const onKeyDown = (edge: "w" | "s" | "n") => (e: React.KeyboardEvent) => {
		const delta = keyDelta(edge, e.key, e.shiftKey)
		if (delta === null) return
		e.preventDefault()
		if (mode === "docked") {
			const { min, max } = dockedLimits(chrome.width, chrome.railReserve)
			const width =
				delta === "min"
					? min
					: delta === "max"
						? max
						: clampDockedWidth(chrome.panelWidth + delta, chrome.width, chrome.railReserve)
			chrome.setPanelSize({ docked: { width } })
		} else if (mode === "overlay" && overlay) {
			const measured = panelRef.current?.getBoundingClientRect().height ?? overlay.height ?? 0
			let next: OverlayRect
			if (edge === "w") {
				const wl = overlayWidthLimits(area)
				const width = delta === "min" ? wl.min : delta === "max" ? wl.max : overlay.width + delta
				// Right-anchored: the right edge stays, the left edge moves.
				next = clampOverlay({ ...overlay, height: overlay.height ?? measured, width }, area, "w")
			} else {
				const hl = overlayHeightLimits(area)
				const height = delta === "min" ? hl.min : delta === "max" ? hl.max : (overlay.height ?? measured) + delta
				next = clampOverlay({ ...overlay, height }, area, "h")
			}
			chrome.setPanelSize({
				overlay: { width: next.width, height: next.height ?? measured, right: next.right, top: next.top },
			})
		} else if (mode === "sheet") {
			const pct =
				delta === "min"
					? SHEET_HEIGHT.minPct
					: delta === "max"
						? SHEET_HEIGHT.maxPct
						: chrome.sheetHeightPct + (delta > 0 ? 5 : -5)
			chrome.setSheetHeightPct(pct)
		}
	}

	if (mode === "sheet") {
		return (
			<div
				aria-label={`Resize ${name} panel height`}
				aria-orientation="horizontal"
				aria-valuemax={SHEET_HEIGHT.maxPct}
				aria-valuemin={SHEET_HEIGHT.minPct}
				aria-valuenow={chrome.sheetHeightPct}
				aria-valuetext={`${chrome.sheetHeightPct}% of the map`}
				className="map-chrome-handle"
				onDoubleClick={chrome.resetPanelSize}
				onKeyDown={onKeyDown("n")}
				onPointerDown={onSheetDown}
				role="separator"
				tabIndex={0}>
				<span className="map-chrome-handle__grip" />
			</div>
		)
	}

	if (mode === "docked") {
		const { min, max } = dockedLimits(chrome.width, chrome.railReserve)
		return (
			<div
				aria-label={`Resize ${name} panel width`}
				aria-orientation="vertical"
				aria-valuemax={max}
				aria-valuemin={min}
				aria-valuenow={chrome.panelWidth}
				aria-valuetext={`${chrome.panelWidth} pixels wide`}
				className="map-panel-resizer map-panel-resizer--w"
				onDoubleClick={chrome.resetPanelSize}
				onKeyDown={onKeyDown("w")}
				onPointerDown={onDockedDown}
				role="separator"
				style={{ zIndex: MAP_Z.local, cursor: "ew-resize" }}
				tabIndex={0}
			/>
		)
	}

	const wl = overlayWidthLimits(area)
	const hl = overlayHeightLimits(area)
	return (
		<>
			{OVERLAY_HANDLES.map((h) => {
				const focusable = FOCUSABLE.includes(h)
				const isWidth = h === "w"
				return (
					<div
						aria-hidden={focusable ? undefined : true}
						aria-label={focusable ? `Resize ${name} panel ${isWidth ? "width" : "height"}` : undefined}
						aria-orientation={focusable ? (isWidth ? "vertical" : "horizontal") : undefined}
						aria-valuemax={focusable ? (isWidth ? wl.max : hl.max) : undefined}
						aria-valuemin={focusable ? (isWidth ? wl.min : hl.min) : undefined}
						aria-valuenow={
							focusable ? Math.round(isWidth ? (overlay?.width ?? 0) : (overlay?.height ?? hl.min)) : undefined
						}
						className={`map-panel-resizer map-panel-resizer--${h}`}
						key={h}
						onDoubleClick={chrome.resetPanelSize}
						onKeyDown={focusable ? onKeyDown(h as "w" | "s") : undefined}
						onPointerDown={onOverlayDown(h)}
						role={focusable ? "separator" : undefined}
						style={{ zIndex: MAP_Z.local, cursor: cursorFor(h) }}
						tabIndex={focusable ? 0 : undefined}
					/>
				)
			})}
		</>
	)
}

/** Write a floating panel's rectangle straight to its element (during a drag, and for the committed render). */
function applyOverlay(panel: HTMLElement, rect: OverlayRect, railReserve: number) {
	panel.style.width = `${rect.width}px`
	if (rect.height !== null) {
		panel.style.height = `${rect.height}px`
		panel.style.maxHeight = "none"
	}
	panel.style.right = `${railReserve + rect.right}px`
	panel.style.top = `${rect.top}px`
}
