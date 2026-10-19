/**
 * Single z-index scale for everything drawn over the map canvas.
 *
 *   canvas 0 < overlay 10 < empty-state 20 < panel 30 < menu 40 < toast 50 < modal 60
 *
 * Use these tokens (or the `--map-z-*` CSS variables in index.css) instead of ad-hoc numbers. Larger values
 * are for things that must hide what is below them: a tool panel covers the empty-state card, a context menu
 * covers a panel, a notice covers a menu, a full-screen preview covers everything.
 * `mapZ.test.ts` fails on a raw numeric `zIndex` anywhere under components/map.
 */
export const MAP_Z = {
	canvas: 0,
	/** Stacking inside one component (resize grips, sticky headers); never compared across components. */
	local: 1,
	/** On-canvas chrome: legend, status bar, ROI strip, swipe divider, drag-and-drop veil. */
	overlay: 10,
	/** "No layers yet" card. Below panels so a tool panel is never covered by it. */
	emptyState: 20,
	/** Ribbon, tool panels, feature inspector and other docked surfaces. */
	panel: 30,
	/** Context menus and dropdowns opened from a panel. */
	menu: 40,
	/** Notices that must not be missed: connection/resource banners, transient toasts. */
	toast: 50,
	/** Full-screen previews and lightboxes. */
	modal: 60,
} as const

export type MapZLevel = keyof typeof MAP_Z
