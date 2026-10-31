import { describe, expect, it } from "vitest"
import {
	clampDockedWidth,
	clampOverlay,
	clampSheetPct,
	defaultOverlayRect,
	dockedLimits,
	keyDelta,
	OVERLAY_MAX_COVER,
	overlayRectFor,
	resizeOverlay,
	sanitizePanelSizes,
} from "../panelSizes"

const area = { width: 760, height: 560 }

describe("docked width", () => {
	it("defaults to 300 and stays between 260 and 640 while the canvas keeps 360 px", () => {
		expect(clampDockedWidth(undefined, 1280, 40)).toBe(300)
		expect(clampDockedWidth(100, 1280, 40)).toBe(260)
		expect(clampDockedWidth(5000, 1920, 40)).toBe(640)
		// 960 map, 40 rail, 360 canvas minimum leaves 560.
		expect(dockedLimits(960, 40).max).toBe(560)
		expect(clampDockedWidth(5000, 960, 40)).toBe(560)
	})
})

describe("overlay rectangle", () => {
	it("starts 300 wide with content height, 8 px from the top right, and 40% of a narrow area at most", () => {
		expect(defaultOverlayRect(area)).toEqual({ width: 300, height: null, right: 8, top: 8 })
		expect(defaultOverlayRect({ width: 500, height: 500 }).width).toBe(200)
	})

	it("never covers more than 40% of the canvas: the side being dragged gives way", () => {
		const cap = OVERLAY_MAX_COVER * area.width * area.height
		const wide = clampOverlay({ width: 640, height: 540, right: 8, top: 8 }, area, "h")
		expect(wide.width * (wide.height as number)).toBeLessThanOrEqual(cap)
		expect(wide.width).toBe(640)
		const tall = clampOverlay({ width: 640, height: 540, right: 8, top: 8 }, area, "w")
		expect(tall.width * (tall.height as number)).toBeLessThanOrEqual(cap)
		expect(tall.height).toBe(540)
	})

	it("keeps the whole panel on screen when the window shrinks", () => {
		const fitted = clampOverlay({ width: 400, height: 300, right: 600, top: 500 }, { width: 600, height: 400 }, "w")
		expect(fitted.right).toBeLessThanOrEqual(600 - fitted.width)
		expect(fitted.top).toBeLessThanOrEqual(400 - 300)
		expect(fitted.right).toBeGreaterThanOrEqual(0)
	})

	it("falls back to the default for a size nobody saved, and fits a saved one to the current area", () => {
		expect(overlayRectFor(undefined, area)).toEqual({ width: 300, height: null, right: 8, top: 8 })
		const saved = overlayRectFor({ overlay: { width: 600, height: 400, right: 8, top: 8 } }, { width: 700, height: 500 })
		expect(saved.width * (saved.height as number)).toBeLessThanOrEqual(0.4 * 700 * 500)
	})
})

describe("resizing an overlay by an edge or corner", () => {
	const start = { width: 300, height: 300, right: 8, top: 8 }

	it("the west edge dragged left widens the panel and keeps its right edge", () => {
		const next = resizeOverlay(start, "w", -80, 0, area)
		expect(next.width).toBe(380)
		expect(next.right).toBe(8)
	})

	it("the east edge dragged right widens it and keeps its left edge", () => {
		const next = resizeOverlay(start, "e", -4, 0, area)
		// Left edge was area.width - 8 - 300 = 452; width 296 means right inset 12.
		expect(next.width).toBe(296)
		expect(next.right).toBe(760 - 452 - 296)
	})

	it("the north edge dragged up grows the panel upward until the top of the area", () => {
		const next = resizeOverlay({ ...start, top: 100 }, "n", 0, -60, area)
		expect(next.height).toBe(360)
		expect(next.top).toBe(40)
	})

	it("a corner changes both sides and respects the minimums", () => {
		const next = resizeOverlay(start, "se", -500, -500, area)
		expect(next.width).toBe(260)
		expect(next.height).toBe(160)
		expect(next.top).toBe(8)
	})
})

describe("sheet height", () => {
	it("is a share of the map between 30 and 85", () => {
		expect([clampSheetPct(undefined), clampSheetPct(10), clampSheetPct(99)]).toEqual([55, 30, 85])
	})
})

describe("keyboard", () => {
	it("moves the edge the way it looks", () => {
		expect(keyDelta("w", "ArrowLeft", false)).toBe(16)
		expect(keyDelta("w", "ArrowRight", false)).toBe(-16)
		expect(keyDelta("w", "ArrowLeft", true)).toBe(64)
		expect(keyDelta("s", "ArrowDown", false)).toBe(16)
		expect(keyDelta("n", "ArrowUp", false)).toBe(16)
		expect(keyDelta("w", "ArrowUp", false)).toBeNull()
		expect(keyDelta("w", "Home", false)).toBe("min")
		expect(keyDelta("w", "End", false)).toBe("max")
	})
})

describe("stored sizes", () => {
	it("drops anything that is not a finite number", () => {
		expect(
			sanitizePanelSizes({
				layers: { docked: { width: 420 }, overlay: { width: "x" }, sheet: { heightPct: 60 } },
				search: "nope",
				pins: { overlay: { width: 320, height: Number.NaN, right: 12 } },
			}),
		).toEqual({ layers: { docked: { width: 420 }, sheet: { heightPct: 60 } }, pins: { overlay: { width: 320, right: 12 } } })
		expect(sanitizePanelSizes(null)).toEqual({})
		expect(sanitizePanelSizes([1])).toEqual({})
	})
})
