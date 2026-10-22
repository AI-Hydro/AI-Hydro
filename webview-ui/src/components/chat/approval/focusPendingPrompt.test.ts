import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { focusPendingPrompt } from "./focusPendingPrompt"

function el(testid: string, tag = "div") {
	const e = document.createElement(tag)
	e.setAttribute("data-testid", testid)
	e.tabIndex = -1
	document.body.appendChild(e)
	return e
}

beforeEach(() => {
	document.body.innerHTML = ""
	vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe("focusPendingPrompt", () => {
	it("focuses the approval group, never the Run button inside it", () => {
		const group = el("inline-approval")
		const run = document.createElement("button")
		group.appendChild(run)
		const fallback = vi.fn()
		focusPendingPrompt(fallback)
		expect(document.activeElement).toBe(group)
		expect(document.activeElement).not.toBe(run)
		expect(fallback).not.toHaveBeenCalled()
	})

	it("focuses the last group (the pending ask is the tail)", () => {
		el("inline-approval")
		const last = el("inline-approval")
		focusPendingPrompt(vi.fn())
		expect(document.activeElement).toBe(last)
	})

	it("falls back to the footer action group for asks that keep footer buttons", () => {
		const footer = el("footer-actions")
		focusPendingPrompt(vi.fn())
		expect(document.activeElement).toBe(footer)
	})

	it("waits briefly for the card to mount, then finds it", () => {
		focusPendingPrompt(vi.fn())
		const group = el("inline-approval")
		vi.advanceTimersByTime(60)
		expect(document.activeElement).toBe(group)
	})

	it("uses the fallback (the composer) when nothing is pending on screen", () => {
		const fallback = vi.fn()
		focusPendingPrompt(fallback)
		vi.advanceTimersByTime(1000)
		expect(fallback).toHaveBeenCalledOnce()
	})
})
