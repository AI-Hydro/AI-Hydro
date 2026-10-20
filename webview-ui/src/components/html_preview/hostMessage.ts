/**
 * Who may speak to the preview shell.
 *
 * The shell sits between two kinds of sender: the VS Code extension host (replies to the
 * requests the shell made) and the HTML document in the preview iframe (untrusted). A sandboxed
 * document can also open popups (`allow-popups`) and create nested frames, so "a message
 * arrived" says nothing about who sent it; the sender window has to be checked.
 */

/**
 * Whether `candidate` is this window. Same-window references can be different objects (the
 * `window` global is a wrapper under jsdom), so also compare documents, which a cross-origin
 * window cannot expose (reading it throws, which means "not us").
 */
function isThisWindow(candidate: Window): boolean {
	if (candidate === window) return true
	try {
		return candidate.document === document
	} catch {
		return false
	}
}

/**
 * True unless the message was sent by a window that descends from this shell: the document
 * iframe, a frame nested in it, or a popup it (or such a frame) opened. A message from the
 * extension host comes from outside this window (VS Code delivers it through the enclosing
 * frames), so walking the sender's `parent`/`opener` chain never reaches this window.
 *
 * This is deliberately "reject document-derived senders" rather than "accept only a known host
 * window": VS Code does not promise which window object delivers host messages, but a document
 * can only ever be below this window. `parent`, `opener` and equality are the cross-origin-safe
 * operations on a WindowProxy. A null source (synthetic events in unit tests) is accepted.
 */
export function isFromHost(event: MessageEvent): boolean {
	let sender = event.source as Window | null
	if (!sender || isThisWindow(sender)) return true
	for (let hops = 0; hops < 16; hops++) {
		if (isThisWindow(sender)) return false
		const parent: Window | null = sender.parent
		const next: Window | null = parent && parent !== sender ? parent : sender.opener
		if (!next) return true
		sender = next
	}
	// An implausibly deep chain: refuse rather than guess.
	return false
}

/** True for a message from a direct child frame of the shell (the document iframe), never a popup or a grandchild. */
export function isFromChildFrame(event: MessageEvent): boolean {
	if (!event.source) return false
	for (let i = 0; i < window.frames.length; i++) {
		if (window.frames[i] === event.source) return true
	}
	return false
}
