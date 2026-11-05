import { afterEach, describe, expect, it } from "vitest"
import { startFocusHandoff } from "../focusHandoff"

const button = (label: string) => {
	const b = document.createElement("button")
	b.textContent = label
	document.body.appendChild(b)
	return b
}
afterEach(() => {
	document.body.innerHTML = ""
})

describe("focus handoff", () => {
	it("moves focus when it is still where the action began, or on the body, or on an element that left the page", () => {
		const origin = button("origin")
		origin.focus()
		const target = button("target")
		expect(startFocusHandoff().tryFocus(target)).toBe(true)
		expect(target).toHaveFocus()
		const gone = button("gone")
		gone.focus()
		const h = startFocusHandoff()
		gone.remove()
		expect(h.tryFocus(target)).toBe(true)
	})

	it("does not move focus once the user focused something else, and stays cancelled", () => {
		const origin = button("origin")
		origin.focus()
		const h = startFocusHandoff()
		const other = button("other")
		other.focus()
		expect(h.tryFocus(button("target"))).toBe(false)
		expect(h.cancelled).toBe(true)
		origin.focus()
		other.focus()
		expect(h.tryFocus(origin)).toBe(false)
		expect(other).toHaveFocus()
	})

	it("a key pressed in another control cancels it", () => {
		const origin = button("origin")
		origin.focus()
		const h = startFocusHandoff()
		const field = document.createElement("input")
		document.body.appendChild(field)
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }))
		expect(h.cancelled).toBe(true)
	})
})
