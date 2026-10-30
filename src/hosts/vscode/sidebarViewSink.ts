import type { SidebarView } from "@core/controller/ui/sidebarView"

/** The context key the view-title buttons' `toggled` clauses read (package.json). */
export const SIDEBAR_VIEW_CONTEXT = "aihydro.sidebarView"

/** Draws the sidebar view as a context key. `setContext` is injected so this stays free of the `vscode` runtime. */
export function applySidebarView(view: SidebarView, setContext: (key: string, value: string) => void | Thenable<unknown>): void {
	void setContext(SIDEBAR_VIEW_CONTEXT, view)
}
