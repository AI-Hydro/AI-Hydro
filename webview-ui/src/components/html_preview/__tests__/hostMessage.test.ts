import { describe, expect, it } from "vitest"
import { isFromChildFrame, isFromHost } from "../hostMessage"

const withSource = (source: unknown, data: unknown = {}) => {
	const event = new MessageEvent("message", { data })
	Object.defineProperty(event, "source", { value: source, configurable: true })
	return event
}

describe("isFromHost", () => {
	it("accepts senders outside this window and synthetic events with no source", () => {
		expect(isFromHost(withSource(null))).toBe(true)
		expect(isFromHost(withSource(window))).toBe(true)
		// An ancestor (the VS Code host side): its parent chain ends without reaching this window.
		const top = { parent: undefined as unknown, opener: null } as { parent: unknown; opener: unknown }
		top.parent = top
		const host = { parent: top, opener: null }
		expect(isFromHost(withSource(host))).toBe(true)
		expect(isFromHost(withSource(top))).toBe(true)
	})

	it("rejects the document iframe, a frame nested in it, and a popup opened by either", () => {
		const iframe = document.createElement("iframe")
		document.body.appendChild(iframe)
		const doc = iframe.contentWindow as Window
		expect(isFromHost(withSource(doc))).toBe(false)
		const nested = { parent: doc, opener: null }
		expect(isFromHost(withSource(nested))).toBe(false)
		const popup = { opener: doc } as { parent: unknown; opener: unknown }
		popup.parent = popup
		expect(isFromHost(withSource(popup))).toBe(false)
		const popupOfNested = { opener: nested } as { parent: unknown; opener: unknown }
		popupOfNested.parent = popupOfNested
		expect(isFromHost(withSource(popupOfNested))).toBe(false)
		iframe.remove()
	})
})

describe("isFromChildFrame", () => {
	it("accepts a direct child frame and rejects anything else", () => {
		const iframe = document.createElement("iframe")
		document.body.appendChild(iframe)
		expect(isFromChildFrame(withSource(iframe.contentWindow))).toBe(true)
		expect(isFromChildFrame(withSource({ popup: true }))).toBe(false)
		expect(isFromChildFrame(withSource(null))).toBe(false)
		iframe.remove()
	})
})
