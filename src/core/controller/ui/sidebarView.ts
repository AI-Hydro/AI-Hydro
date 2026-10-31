/**
 * Which view the sidebar is showing. The webview owns navigation (a view-title button, a Done button, an in-chat
 * link all change it), so it reports each change and this holds the latest. Host-neutral: the VS Code webview
 * provider registers a sink that turns it into the `aihydro.sidebarView` context key the view-title buttons read
 * (`toggled` clauses in package.json). State lives here, not in the sink, so a re-resolved view can redraw it.
 */
export const SIDEBAR_VIEWS = ["chat", "history", "settings", "mcp", "connectors", "skills", "map"] as const
export type SidebarView = (typeof SIDEBAR_VIEWS)[number]

type Sink = (view: SidebarView) => void

let current: SidebarView = "chat"
let sink: Sink | undefined

/** Anything that is not a known view is the chat: a stale or newer webview never leaves a button toggled. */
export function parseSidebarView(value: string | undefined): SidebarView {
	return (SIDEBAR_VIEWS as readonly string[]).includes(value ?? "") ? (value as SidebarView) : "chat"
}

export function getSidebarView(): SidebarView {
	return current
}

export function setSidebarViewSink(fn: Sink | undefined): void {
	sink = fn
	// A newly registered sink (view re-resolved) draws the current view.
	if (fn) {
		publish()
	}
}

function publish(): void {
	try {
		sink?.(current)
	} catch (error) {
		console.warn("sidebarView: sink failed", error)
	}
}

export function reportSidebarView(value: string | undefined): SidebarView {
	current = parseSidebarView(value)
	publish()
	return current
}

/** The view is gone (disposed): nothing is open, so nothing is toggled. */
export function resetSidebarView(): void {
	current = "chat"
	publish()
}
