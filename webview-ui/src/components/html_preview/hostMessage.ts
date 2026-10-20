/**
 * Who may speak to the preview shell.
 *
 * The shell sits between two kinds of sender: the VS Code extension host (replies to the
 * requests the shell made) and the HTML document in the preview iframe (untrusted). A sandboxed
 * document can also open popups (`allow-popups`) and create nested frames, so "a message
 * arrived" says nothing about who sent it; the sender window has to be checked.
 */

/**
 * True for a message from the extension host. In a VS Code webview the host's messages are
 * delivered by the enclosing frame, so the sender is this window or its parent. A message from
 * the document's iframe, a frame nested in it, or a popup it opened has a different sender and
 * is rejected. A null source (synthetic events in unit tests) is accepted.
 */
export function isFromHost(event: MessageEvent): boolean {
	return event.source === null || event.source === window || event.source === window.parent
}

/** True for a message from a direct child frame of the shell (the document iframe), never a popup or a grandchild. */
export function isFromChildFrame(event: MessageEvent): boolean {
	if (!event.source) return false
	for (let i = 0; i < window.frames.length; i++) {
		if (window.frames[i] === event.source) return true
	}
	return false
}
