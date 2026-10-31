/**
 * Panel sizes: how big a map tool panel is, per panel and per window state, and the rules that keep it usable.
 *
 * A "window state" is the placement mapChrome.ts picks from the map width: docked, overlay or sheet. The same panel
 * remembers a separate size for each, because a width that suits a docked column is wrong for a floating panel.
 *
 *   docked   a column on the right of the canvas: only its width changes (drag the left edge)
 *   overlay  a floating box: width, height and position change (drag any edge or corner)
 *   sheet    a bottom sheet: its height as a share of the map (drag the handle on top)
 *
 * Everything here is pure (no DOM), so the rules are unit tested. The stored values are what the user asked for; they
 * are clamped again against the current map every time they are used, never rewritten, so a panel that was squeezed
 * by a small window gets its size back when the window grows.
 */

import type { PanelMode } from "./mapChrome"

/** Smallest and largest panel width, in px, before the share-of-map caps apply. */
export const PANEL_MIN_WIDTH = 260
export const PANEL_MAX_WIDTH = 640
export const PANEL_DEFAULT_WIDTH = 300
/** Smallest overlay height, in px. */
export const OVERLAY_MIN_HEIGHT = 160
/** An overlay panel (width x height) never covers more than this share of the canvas (map-polish.md section 4.3). */
export const OVERLAY_MAX_COVER = 0.4
/** A docked panel leaves the canvas at least this much room. */
export const DOCKED_MIN_CANVAS = 360
/** Gap kept between a floating panel and the edge of the canvas by default. */
export const OVERLAY_GAP = 8
/** Keyboard step for resizing, and the larger step with Shift. */
export const KEY_STEP = 16
export const KEY_STEP_LARGE = 64
export const SHEET_MIN_PCT = 30
export const SHEET_MAX_PCT = 85
export const SHEET_DEFAULT_PCT = 55

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"

/** The canvas area a floating panel lives in (the map minus the rail column). */
export interface Area {
	width: number
	height: number
}

/** A floating panel. `right` and `top` are insets from the area's right and top edges. `height` null means "fit the content". */
export interface OverlayRect {
	width: number
	height: number | null
	right: number
	top: number
}

export interface PanelSizeRecord {
	docked?: { width: number }
	overlay?: { width: number; height?: number; right?: number; top?: number }
	sheet?: { heightPct: number }
}

/** Stored sizes keyed by panel family (`layers`, `search`, `annotations`, ...). */
export type PanelSizes = Record<string, PanelSizeRecord>

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

// ── docked ──────────────────────────────────────────────────────────────────

/** The docked width limits for a map this wide. The canvas always keeps room, and the max never undercuts the min. */
export function dockedLimits(mapWidth: number, railReserve: number): { min: number; max: number } {
	const room = Math.floor(mapWidth - railReserve - DOCKED_MIN_CANVAS)
	const max = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, room))
	return { min: PANEL_MIN_WIDTH, max }
}

export function clampDockedWidth(width: number | undefined, mapWidth: number, railReserve: number): number {
	const { min, max } = dockedLimits(mapWidth, railReserve)
	return Math.round(clamp(isNum(width) ? width : PANEL_DEFAULT_WIDTH, min, max))
}

// ── overlay ─────────────────────────────────────────────────────────────────

export function overlayWidthLimits(area: Area): { min: number; max: number } {
	// The share cap wins over the 260 px floor, so a very narrow map is never swallowed.
	const min = Math.min(PANEL_MIN_WIDTH, Math.floor(area.width * OVERLAY_MAX_COVER))
	const max = Math.max(min, Math.min(PANEL_MAX_WIDTH, Math.floor(area.width - OVERLAY_GAP * 2)))
	return { min, max }
}

export function overlayHeightLimits(area: Area): { min: number; max: number } {
	const max = Math.max(OVERLAY_MIN_HEIGHT, Math.floor(area.height - OVERLAY_GAP * 2))
	return { min: Math.min(OVERLAY_MIN_HEIGHT, max), max }
}

/** The default floating panel: 300 px wide (or 40% of a narrow map), content height, 8 px from the top right. */
export function defaultOverlayRect(area: Area): OverlayRect {
	const { min, max } = overlayWidthLimits(area)
	return {
		width: clamp(Math.min(PANEL_DEFAULT_WIDTH, Math.floor(area.width * OVERLAY_MAX_COVER)), min, max),
		height: null,
		right: OVERLAY_GAP,
		top: OVERLAY_GAP,
	}
}

/**
 * Fit a floating panel to the area. `axis` says which side the user is changing, so when width x height would cover
 * more than 40% of the canvas it is that side that gives way (the edge stops moving) rather than the other.
 */
export function clampOverlay(rect: OverlayRect, area: Area, axis: "w" | "h" = "w"): OverlayRect {
	const wl = overlayWidthLimits(area)
	const hl = overlayHeightLimits(area)
	let width = Math.round(clamp(rect.width, wl.min, wl.max))
	let height = rect.height === null ? null : Math.round(clamp(rect.height, hl.min, hl.max))
	if (height !== null) {
		const cap = Math.floor(OVERLAY_MAX_COVER * area.width * area.height)
		if (width * height > cap) {
			if (axis === "h") {
				height = Math.max(hl.min, Math.floor(cap / width))
				if (width * height > cap) width = Math.max(wl.min, Math.floor(cap / height))
			} else {
				width = Math.max(wl.min, Math.floor(cap / height))
				if (width * height > cap) height = Math.max(hl.min, Math.floor(cap / width))
			}
		}
	}
	// Keep the whole panel on screen. A content-height panel is at least the minimum tall for this purpose.
	const heightForFit = height ?? hl.min
	const right = Math.round(clamp(rect.right, 0, Math.max(0, area.width - width)))
	const top = Math.round(clamp(rect.top, 0, Math.max(0, area.height - heightForFit)))
	return { width, height, right, top }
}

/**
 * Apply a drag of `handle` by (dx, dy) to the rectangle the drag started from. The edge opposite the handle stays
 * where it is. `startHeight` is the measured height when the panel was still content-sized.
 */
export function resizeOverlay(
	start: OverlayRect & { height: number },
	handle: ResizeHandle,
	dx: number,
	dy: number,
	area: Area,
): OverlayRect {
	const startLeft = area.width - start.right - start.width
	const startBottom = start.top + start.height
	const moveW = handle.includes("w")
	const moveE = handle.includes("e")
	const moveN = handle.includes("n")
	const moveS = handle.includes("s")
	let width = start.width + (moveE ? dx : moveW ? -dx : 0)
	let height = start.height + (moveS ? dy : moveN ? -dy : 0)
	const axis: "w" | "h" = (moveN || moveS) && !(moveE || moveW) ? "h" : "w"
	const fitted = clampOverlay({ width, height, right: 0, top: 0 }, area, axis)
	width = fitted.width
	height = fitted.height ?? height
	// Anchor the edge that is not being dragged.
	const left = moveW ? startLeft + start.width - width : startLeft
	const top = moveN ? startBottom - height : start.top
	const right = area.width - left - width
	return clampOverlay({ width, height, right, top }, area, axis)
}

/** Move a floating panel by (dx, dy) from where it started; clamped to stay on screen. */
export function moveOverlay(start: OverlayRect & { height: number }, dx: number, dy: number, area: Area): OverlayRect {
	return clampOverlay({ width: start.width, height: start.height, right: start.right - dx, top: start.top + dy }, area)
}

// ── sheet ───────────────────────────────────────────────────────────────────

export const clampSheetPct = (pct: number | undefined): number =>
	Math.round(clamp(isNum(pct) ? pct : SHEET_DEFAULT_PCT, SHEET_MIN_PCT, SHEET_MAX_PCT))

// ── keyboard ────────────────────────────────────────────────────────────────

/**
 * What an arrow key does to the edge a separator stands for. Arrow keys move the separator the way it looks: the left
 * edge of a right-anchored panel moves left to grow it. Returns the pixel change to the panel's size (+ grows), or
 * null when the key is not for this edge. Home / End jump to the limits.
 */
export function keyDelta(edge: "w" | "e" | "n" | "s", key: string, shift: boolean): number | "min" | "max" | null {
	const step = shift ? KEY_STEP_LARGE : KEY_STEP
	if (key === "Home") return "min"
	if (key === "End") return "max"
	const grows: Record<string, number> =
		edge === "w"
			? { ArrowLeft: step, ArrowRight: -step }
			: edge === "e"
				? { ArrowRight: step, ArrowLeft: -step }
				: edge === "n"
					? { ArrowUp: step, ArrowDown: -step }
					: { ArrowDown: step, ArrowUp: -step }
	return key in grows ? grows[key] : null
}

// ── persistence shape ───────────────────────────────────────────────────────

/** Keep only well-formed numbers from whatever localStorage held; anything else is dropped, never trusted. */
export function sanitizePanelSizes(raw: unknown): PanelSizes {
	const out: PanelSizes = {}
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!value || typeof value !== "object") continue
		const v = value as Record<string, any>
		const record: PanelSizeRecord = {}
		if (isNum(v.docked?.width)) record.docked = { width: v.docked.width }
		if (isNum(v.overlay?.width)) {
			record.overlay = {
				width: v.overlay.width,
				...(isNum(v.overlay.height) ? { height: v.overlay.height } : {}),
				...(isNum(v.overlay.right) ? { right: v.overlay.right } : {}),
				...(isNum(v.overlay.top) ? { top: v.overlay.top } : {}),
			}
		}
		if (isNum(v.sheet?.heightPct)) record.sheet = { heightPct: v.sheet.heightPct }
		if (record.docked || record.overlay || record.sheet) out[key] = record
	}
	return out
}

/** The overlay rectangle to show: the stored one (or the default) fitted to this area. */
export function overlayRectFor(record: PanelSizeRecord | undefined, area: Area): OverlayRect {
	const base = defaultOverlayRect(area)
	const stored = record?.overlay
	if (!stored) return clampOverlay(base, area)
	return clampOverlay(
		{
			width: stored.width,
			height: stored.height ?? null,
			right: stored.right ?? base.right,
			top: stored.top ?? base.top,
		},
		area,
	)
}

export const hasOwnSize = (record: PanelSizeRecord | undefined, mode: PanelMode): boolean => Boolean(record?.[mode])
