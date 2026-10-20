/**
 * Studio shell -> host catch-up handshake.
 *
 * The host answers requests by posting to the panel's current document. While the document is
 * being swapped (the host reassigns the shell HTML when artifacts change the allowed resource
 * roots) those replies can be lost, and the document that finally settles never receives its
 * state: Studio stays empty although the host holds previews. Until this shell has its state it
 * therefore tells the host, with the per-document panel token, that its listeners are up; the
 * host re-sends state and previews to the current subscribers. Sending repeats until the shell
 * reports it has its state, so a lost re-push is also recovered. A stale (replaced) document
 * carries an older token, which the host ignores, so the newest mount wins.
 */
export interface ShellReadyOptions {
	/** Per-document token the host embedded in the shell HTML; without one (sidebar, tests) nothing is sent. */
	getToken: () => string | undefined
	post: (message: { type: "aihydro-shell-ready"; token: string }) => void
	/** True once the shell has applied host state and the preview snapshot. */
	isReady: () => boolean
	intervalMs?: number
	maxAttempts?: number
}

export const SHELL_READY_INTERVAL_MS = 1000
export const SHELL_READY_MAX_ATTEMPTS = 30

/** Starts the handshake; returns a function that stops it (unmount). */
export function startShellReadyHandshake(options: ShellReadyOptions): () => void {
	const intervalMs = options.intervalMs ?? SHELL_READY_INTERVAL_MS
	const maxAttempts = options.maxAttempts ?? SHELL_READY_MAX_ATTEMPTS
	let attempts = 0
	let timer: ReturnType<typeof setTimeout> | undefined
	let stopped = false

	const tick = () => {
		timer = undefined
		if (stopped || options.isReady() || attempts >= maxAttempts) {
			return
		}
		const token = options.getToken()
		if (!token) {
			return
		}
		attempts++
		options.post({ type: "aihydro-shell-ready", token })
		timer = setTimeout(tick, intervalMs)
	}
	// First send after the current task, so providers mounted in this commit have subscribed.
	timer = setTimeout(tick, 0)

	return () => {
		stopped = true
		if (timer !== undefined) {
			clearTimeout(timer)
		}
	}
}
