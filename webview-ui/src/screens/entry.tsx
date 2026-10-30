/**
 * Dev-only entry served by scripts/ui-screens/server.mjs at /screen/<id>.
 * Draws the visible FIXTURE badge, applies the screen's window flags and
 * storage, and routes webview -> host messages to the screen's mock host.
 */
import { createRoot } from "react-dom/client"
import "../index.css"
import { setActiveScreen } from "./active"
import { findScreen, screens } from "./registry"
import { FIXTURE_BANNER } from "./types"

declare global {
	interface Window {
		__hostPost?: (message: Record<string, unknown>) => void
		__screens?: Array<{
			id: string
			title: string
			group: string
			surface: string
			hasMapCanvas: boolean
			ready?: string
			pixelDiffThreshold?: number
			expectVisible?: string[]
			scrollPinned?: string
		}>
		__screenSteps?: unknown
		__screenReady?: boolean
	}
}

const id = decodeURIComponent(location.pathname.replace(/^.*\/screen\//, "").replace(/\/$/, ""))
window.__screens = screens.map((s) => ({
	id: s.id,
	title: s.title,
	group: s.group,
	surface: s.surface,
	hasMapCanvas: !!s.hasMapCanvas,
	ready: s.ready,
	pixelDiffThreshold: s.pixelDiffThreshold,
	expectVisible: s.expectVisible,
	scrollPinned: s.scrollPinned,
}))

const screen = findScreen(id)
const rootEl = document.getElementById("root") as HTMLElement

if (!screen) {
	rootEl.textContent = `Unknown screen: ${id}`
} else {
	setActiveScreen(screen)
	window.__screenSteps = screen.steps ?? []
	for (const flag of screen.flags ?? []) (window as unknown as Record<string, unknown>)[flag] = true
	try {
		for (const [key, value] of Object.entries(screen.storage ?? {})) localStorage.setItem(key, value)
	} catch {
		// storage unavailable: screens still render with defaults
	}
	window.__hostPost = (message) => {
		screen.onMessage?.(message, (reply) =>
			setTimeout(() => window.dispatchEvent(new MessageEvent("message", { data: reply })), 0),
		)
	}
	const badge = document.createElement("div")
	badge.setAttribute("data-harness", "fixture-badge")
	badge.textContent = FIXTURE_BANNER[screen.fixtureKind ?? "synthetic"]
	// Top banner strip: the layout reserves it (#root starts below it), so it never overlaps a control.
	badge.style.cssText =
		"flex:none;height:24px;box-sizing:border-box;padding:0 8px;display:flex;align-items:center;font:700 12px/1 monospace;background:#b00020;color:#fff;pointer-events:none;white-space:nowrap;overflow:hidden"
	document.body.insertBefore(badge, rootEl)
	// Chat screens: really reserve the banner (#root is 100% high, so without this the bottom 24 px of the footer sits
	// below the fold and the composer's last row is clipped). Other screens keep their measured geometry.
	if (screen.group === "chat") rootEl.style.height = "calc(100% - 24px)"
	createRoot(rootEl).render(screen.render())
	requestAnimationFrame(() => {
		window.__screenReady = true
	})
}
