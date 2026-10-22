/**
 * "Focus pending prompt": puts keyboard focus on the thing that answers the ask the agent is waiting on, never on a
 * button that would approve. Order: the inline approval group on the card (last one: the pending ask is the tail),
 * else the footer's action group (asks that keep footer buttons), else `fallback` (the composer: followup and plan
 * replies are typed). Both groups are tabIndex -1 containers, so a stray Enter or Space does nothing.
 *
 * The tail row is always mounted (MessagesArea keeps the viewport open at the bottom), but its content can land a
 * moment after the scroll, so this retries briefly. setTimeout, not requestAnimationFrame: a hidden pane runs no frames.
 */
export const APPROVAL_GROUP_SELECTOR = '[data-testid="inline-approval"]'
export const FOOTER_ACTIONS_SELECTOR = '[data-testid="footer-actions"]'

export function focusPendingPrompt(fallback: () => void, root: ParentNode = document, attempts = 10, intervalMs = 50): void {
	let tries = 0
	const attempt = () => {
		const groups = root.querySelectorAll<HTMLElement>(APPROVAL_GROUP_SELECTOR)
		const target = groups.item(groups.length - 1) ?? root.querySelector<HTMLElement>(FOOTER_ACTIONS_SELECTOR)
		if (target) {
			target.focus()
			return
		}
		if (++tries < attempts) {
			setTimeout(attempt, intervalMs)
		} else {
			fallback()
		}
	}
	attempt()
}
