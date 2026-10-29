/**
 * Chrome coverage rule for the map screens (map-polish.md §4.3, MP1 acceptance 1).
 *
 *   coverage = area(union of [data-map-chrome] boxes clipped to the canvas) / canvas area
 *
 * The map's chrome (rail, collapsed button, edge tab, panel) is measured against the canvas, so a docked panel that
 * shrinks the canvas covers 0%. Transient popovers (`data-map-chrome="menu"`) and modal dialogs
 * (`data-map-chrome="modal"`) are not part of a resting state and are left out.
 *
 * Pure functions here; `measureChromeCoverage` reads the page. The self-test (coverage.selftest.mjs) runs the rule on
 * synthetic boxes so it cannot pass silently.
 */

/** Area of the union of axis-aligned boxes {left, top, right, bottom}. Overlap is counted once. */
export function unionArea(boxes) {
	const valid = boxes.filter((b) => b.right > b.left && b.bottom > b.top)
	if (valid.length === 0) return 0
	const xs = [...new Set(valid.flatMap((b) => [b.left, b.right]))].sort((a, b) => a - b)
	let area = 0
	for (let i = 0; i < xs.length - 1; i++) {
		const x0 = xs[i]
		const x1 = xs[i + 1]
		const spans = valid
			.filter((b) => b.left <= x0 && b.right >= x1)
			.map((b) => [b.top, b.bottom])
			.sort((a, b) => a[0] - b[0])
		let covered = 0
		let curTop = Number.NEGATIVE_INFINITY
		let curBottom = Number.NEGATIVE_INFINITY
		for (const [top, bottom] of spans) {
			if (top > curBottom) {
				if (curBottom > curTop) covered += curBottom - curTop
				curTop = top
				curBottom = bottom
			} else if (bottom > curBottom) {
				curBottom = bottom
			}
		}
		if (curBottom > curTop) covered += curBottom - curTop
		area += covered * (x1 - x0)
	}
	return area
}

/** Share of `canvas` covered by the union of `chrome`, each box clipped to the canvas first. 0 for an empty canvas. */
export function coverageRatio(chrome, canvas) {
	const canvasArea = Math.max(0, canvas.right - canvas.left) * Math.max(0, canvas.bottom - canvas.top)
	if (canvasArea === 0) return 0
	const clipped = chrome.map((b) => ({
		left: Math.max(b.left, canvas.left),
		top: Math.max(b.top, canvas.top),
		right: Math.min(b.right, canvas.right),
		bottom: Math.min(b.bottom, canvas.bottom),
	}))
	return unionArea(clipped) / canvasArea
}

/**
 * The budget for a resting state (plan §4.3). `mode` is the panel placement (docked, overlay, sheet); `width` is the
 * map width. A docked panel and the rail own their columns, so the canvas is not covered at all; the small epsilon
 * absorbs sub-pixel rounding.
 */
export function coverageLimit({ width, panelOpen, mode }) {
	if (panelOpen) {
		if (mode === "docked") return 0.001
		if (mode === "overlay") return 0.4
		return 0.6
	}
	return width >= 800 ? 0.06 : 0.03
}

/** Read the page: chrome boxes, canvas box, mode and panel state. Null when the screen has no map chrome. */
export async function measureChromeCoverage(page) {
	const raw = await page.evaluate(() => {
		const root = document.querySelector("[data-map-chrome-root]")
		const canvas = document.querySelector("canvas#ai-hydro-research-map")
		if (!root || !canvas) return null
		const rect = (el) => {
			const r = el.getBoundingClientRect()
			return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
		}
		const boxes = [...document.querySelectorAll("[data-map-chrome]")]
			.filter((el) => !["menu", "modal"].includes(el.getAttribute("data-map-chrome")))
			.filter((el) => {
				const r = el.getBoundingClientRect()
				return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"
			})
			.map((el) => ({ kind: el.getAttribute("data-map-chrome"), ...rect(el) }))
		return {
			mode: root.getAttribute("data-map-chrome-mode"),
			state: root.getAttribute("data-map-chrome-state"),
			panelOpen: root.getAttribute("data-map-panel-open") === "true",
			width: document.documentElement.clientWidth,
			canvas: rect(canvas),
			boxes,
		}
	})
	if (!raw) return null
	const ratio = coverageRatio(raw.boxes, raw.canvas)
	const limit = coverageLimit(raw)
	return { ...raw, ratio, limit, ok: ratio <= limit }
}
