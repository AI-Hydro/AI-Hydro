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

describe("isFromHost with a per-panel token", () => {
	const TOKEN = "t0k3n-abc"
	const setToken = (value: string | undefined) => {
		;(window as { __aihydroPanelToken?: string }).__aihydroPanelToken = value
	}
	const host = () => {
		const top = { opener: null } as { parent: unknown; opener: unknown }
		top.parent = top
		return top
	}

	it("accepts a host reply that carries the token and rejects one that does not", () => {
		setToken(TOKEN)
		try {
			expect(isFromHost(withSource(host(), { type: "aihydro-course-loaded", token: TOKEN }))).toBe(true)
			expect(isFromHost(withSource(host(), { type: "aihydro-course-loaded" }))).toBe(false)
			expect(isFromHost(withSource(host(), { type: "aihydro-course-loaded", token: "guess" }))).toBe(false)
			expect(isFromHost(withSource(host(), null))).toBe(false)
		} finally {
			setToken(undefined)
		}
	})

	it("rejects forged replies whatever the sender looks like: null source, severed opener, nested frame", () => {
		setToken(TOKEN)
		try {
			const forged = { type: "aihydro-agent-navigate", courseId: "c", moduleId: "m" }
			// A window closed right after posting: the event arrives with source === null.
			expect(isFromHost(withSource(null, forged))).toBe(false)
			// A popup that set window.opener = null looks like a top-level window.
			expect(isFromHost(withSource(host(), forged))).toBe(false)
			const iframe = document.createElement("iframe")
			document.body.appendChild(iframe)
			expect(isFromHost(withSource(iframe.contentWindow, forged))).toBe(false)
			iframe.remove()
		} finally {
			setToken(undefined)
		}
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
