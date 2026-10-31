/**
 * Open the AI-Hydro Map beside the chat the first time the sidebar chat is shown in a window.
 *
 * Rules (the owner's, each covered by a test):
 * - once per window session: after the one attempt the map is never auto-opened again, so a user who closes it keeps
 *   it closed;
 * - never on activation alone: only a visible sidebar triggers it (VS Code resolves the view only when it is shown);
 * - if the sidebar is hidden when the (short) delay ends, nothing opens and the trigger stays armed;
 * - if a map already exists (the user opened it, or VS Code restored it) it is left alone;
 * - the map never takes focus from the chat (the opener must use `preserveFocus`);
 * - off when `aihydro.map.openWithChat` is false.
 *
 * Pure: the VS Code facts are injected so the rules are unit-testable without a host.
 */
export interface MapAutoOpenDeps {
	/** `aihydro.map.openWithChat`. */
	enabled: () => boolean
	/** A map panel or tab already exists in this window. */
	mapExists: () => boolean
	/** The sidebar chat view is visible now. */
	sidebarVisible: () => boolean
	/** Open the map without taking focus. */
	open: () => Promise<void>
	/** Wait this long after the sidebar shows, so the chat renders before the map bundle loads (startup cost). */
	delayMs?: number
	setTimeout?: (fn: () => void, ms: number) => unknown
	clearTimeout?: (handle: unknown) => void
	log?: (message: string, error?: unknown) => void
}

export interface MapAutoOpen {
	/** Call when the sidebar chat view is resolved or becomes visible. */
	onSidebarShown(): void
	/** Cancel a pending delayed open (extension deactivation or window close). */
	dispose(): void
}

export const MAP_AUTO_OPEN_DELAY_MS = 1200

export function createMapAutoOpen(deps: MapAutoOpenDeps): MapAutoOpen {
	const schedule = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
	let settled = false
	let pending = false
	let handle: unknown
	let disposed = false
	const cancel = deps.clearTimeout ?? ((h: unknown) => clearTimeout(h as NodeJS.Timeout))

	const attempt = async () => {
		pending = false
		handle = undefined
		// Re-check at fire time: the sidebar may have been hidden, the setting turned off or a map opened meanwhile.
		if (disposed || settled || !deps.enabled() || !deps.sidebarVisible()) {
			return
		}
		settled = true
		if (deps.mapExists()) {
			return
		}
		try {
			await deps.open()
		} catch (error) {
			deps.log?.("Could not open the map beside the chat", error)
		}
	}

	return {
		onSidebarShown() {
			if (disposed || settled || pending || !deps.enabled() || !deps.sidebarVisible()) {
				return
			}
			pending = true
			handle = schedule(() => void attempt(), deps.delayMs ?? MAP_AUTO_OPEN_DELAY_MS)
		},
		dispose() {
			disposed = true
			if (handle !== undefined) {
				cancel(handle)
				handle = undefined
			}
			pending = false
		},
	}
}
