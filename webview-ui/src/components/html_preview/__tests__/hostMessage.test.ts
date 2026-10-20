import { describe, expect, it } from "vitest"
import { isFromChildFrame, isFromHost } from "../hostMessage"

const withSource = (source: unknown, data: unknown = {}) => {
	const event = new MessageEvent("message", { data })
	Object.defineProperty(event, "source", { value: source, configurable: true })
	return event
}

describe("isFromHost", () => {
	it("accepts the enclosing frame, this window, and synthetic events with no source", () => {
		expect(isFromHost(withSource(window.parent))).toBe(true)
		expect(isFromHost(withSource(window))).toBe(true)
		expect(isFromHost(withSource(null))).toBe(true)
	})

	it("rejects the document iframe, a nested frame and a popup", () => {
		const iframe = document.createElement("iframe")
		document.body.appendChild(iframe)
		expect(isFromHost(withSource(iframe.contentWindow))).toBe(false)
		expect(isFromHost(withSource({ postMessage: () => {} }))).toBe(false)
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
