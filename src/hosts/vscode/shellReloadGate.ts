/**
 * Serialises reloads of the Studio shell webview.
 *
 * Every content update VS Code receives for a webview (`webview.html =` and `webview.options =`
 * each send one) replaces the shell document. If a second update arrives while the previous
 * document is still loading, two shell documents run side by side and neither is ever wired to
 * the host: the host's replies are lost, Studio stays empty, and the trust bar never appears.
 * It shows up on slow runners (Windows CI), but nothing about it is platform specific.
 *
 * The gate therefore allows one reload in flight. Further requests while a document is loading
 * coalesce into a single follow-up reload that starts only after the loading document has
 * reported, by its own `aihydro-shell-ready` message, that its listeners are up. A watchdog
 * releases the gate if a document never reports, so one lost shell cannot block reloads forever.
 */
export class ShellReloadGate {
	private loading = false
	private dirty = false
	private cancelWatchdog: (() => void) | undefined
	private readonly seen = new Set<string>()

	constructor(
		/** Performs the content update (sets `webview.options` / `webview.html`). */
		private readonly apply: () => void,
		/** Schedules a callback; returns a function that cancels it. Injected so tests need no real timers. */
		private readonly schedule: (fn: () => void, ms: number) => () => void,
		private readonly settleTimeoutMs = 10_000,
	) {}

	/** Ask for a reload. Runs now if none is in flight, otherwise is coalesced into one follow-up. */
	request(): void {
		if (this.loading) {
			this.dirty = true
			return
		}
		this.start()
	}

	/** Record that a load has been started outside the gate (the initial `html` assignment). */
	markLoading(): void {
		this.loading = true
		this.dirty = false
		this.cancelWatchdog?.()
		this.cancelWatchdog = this.schedule(() => this.settle(), this.settleTimeoutMs)
	}

	/**
	 * A shell document reported ready. Only a document the host has not heard from before can be the
	 * one that was loading; repeats from a document that already settled (its handshake keeps asking
	 * until it has state) and late messages from a replaced document are not new.
	 */
	shellReady(instance: unknown): void {
		if (typeof instance !== "string" || instance === "") {
			return
		}
		const fresh = !this.seen.has(instance)
		this.seen.add(instance)
		if (fresh && this.loading) {
			this.settle()
		}
	}

	/** True while a reload is in flight (exposed for tests and diagnostics). */
	get isLoading(): boolean {
		return this.loading
	}

	dispose(): void {
		this.cancelWatchdog?.()
		this.cancelWatchdog = undefined
		this.loading = false
		this.dirty = false
	}

	private start(): void {
		this.markLoading()
		this.apply()
	}

	private settle(): void {
		this.cancelWatchdog?.()
		this.cancelWatchdog = undefined
		this.loading = false
		if (this.dirty) {
			this.start()
		}
	}
}

/** Order-independent identity of a set of resource roots, used to tell whether a reload is needed at all. */
export function rootsKey(roots: readonly { toString(): string }[]): string {
	return roots
		.map((r) => r.toString())
		.sort()
		.join("\n")
}
