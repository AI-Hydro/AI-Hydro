/**
 * Moves keyboard focus to a row that just moved, without ever taking it from a user who went somewhere else.
 *
 * Load and Unload move a row to another place; focus follows so a keyboard user is not left on a row that is gone. But
 * the row may be drawn a moment later (a virtualised list, a layer the panel is still parsing), and in that moment the
 * user may have clicked or tabbed to another control. Starting a handoff records where focus was when the action began.
 * Focus is moved only while it is still there, on the page body, or on an element that has left the page. A `focusin` or
 * `keydown` anywhere else cancels the handoff for good.
 */
export interface FocusHandoff {
	/** Moves focus to `el` if the handoff still holds. Returns whether it did. A handoff is used up once it moves focus. */
	tryFocus(el: HTMLElement | null | undefined): boolean
	cancel(): void
	readonly cancelled: boolean
}

/** A handoff that is never used ends by itself after this long. */
const HANDOFF_MS = 8_000

export function startFocusHandoff(doc: Document = document): FocusHandoff {
	const origin = doc.activeElement
	let cancelled = false
	let timer: number | undefined
	const cancel = () => {
		if (cancelled) return
		cancelled = true
		doc.removeEventListener("focusin", onElsewhere, true)
		doc.removeEventListener("keydown", onElsewhere, true)
		window.clearTimeout(timer)
	}
	function onElsewhere(event: Event) {
		const target = event.target as Node | null
		if (target && target !== origin && target !== doc.body && target !== doc.documentElement) cancel()
	}
	doc.addEventListener("focusin", onElsewhere, true)
	doc.addEventListener("keydown", onElsewhere, true)
	timer = window.setTimeout(cancel, HANDOFF_MS)
	return {
		tryFocus(el) {
			if (cancelled || !el) return false
			const active = doc.activeElement
			const stillWhereItWas = !active || active === origin || active === doc.body || !active.isConnected
			if (!stillWhereItWas) {
				cancel()
				return false
			}
			cancel()
			el.focus({ preventScroll: true })
			return true
		},
		cancel,
		get cancelled() {
			return cancelled
		},
	}
}
