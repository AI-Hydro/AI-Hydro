import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BasemapNotice, REARM_DELAY_MS } from "../BasemapNotice"

afterEach(cleanup)

it("renders nothing without messages", () => {
	const { container } = render(<BasemapNotice messages={[]} />)
	expect(container).toBeEmptyDOMElement()
})

it("shows a non-blocking status (not an alert) with a switch-to-default action and dismiss", () => {
	const useDefault = vi.fn()
	render(
		<BasemapNotice
			messages={[{ key: "c", text: "USGS Topo covers the United States only, so no tiles are shown here." }]}
			onUseDefault={useDefault}
		/>,
	)
	expect(screen.getByRole("status")).toHaveTextContent("covers the United States only")
	expect(screen.queryByRole("alert")).toBeNull()
	fireEvent.click(screen.getByRole("button", { name: "Use Hydrology default" }))
	expect(useDefault).toHaveBeenCalledOnce()
	fireEvent.click(screen.getByRole("button", { name: "Dismiss basemap notice" }))
	expect(screen.queryByRole("status")).toBeNull()
})

it("omits the switch action when the default is already active", () => {
	render(<BasemapNotice messages={[{ key: "p", text: "Basemap unavailable" }]} />)
	expect(screen.queryByRole("button", { name: "Use Hydrology default" })).toBeNull()
})

it("a new message appears after an earlier one was dismissed", () => {
	const { rerender } = render(<BasemapNotice messages={[{ key: "a", text: "first" }]} />)
	fireEvent.click(screen.getByRole("button", { name: "Dismiss basemap notice" }))
	rerender(
		<BasemapNotice
			messages={[
				{ key: "a", text: "first" },
				{ key: "b", text: "second" },
			]}
		/>,
	)
	expect(screen.getByRole("status")).toHaveTextContent("second")
	expect(screen.getByRole("status")).not.toHaveTextContent("first")
})

describe("re-arming after dismissal", () => {
	const message = { key: "coverage:usgs-topo", text: "USGS Topo covers the United States only, so no tiles are shown here." }
	afterEach(() => vi.useRealTimers())

	it("shows again once the condition has stayed clear for the hysteresis delay", () => {
		vi.useFakeTimers()
		const { rerender } = render(<BasemapNotice messages={[message]} />)
		fireEvent.click(screen.getByRole("button", { name: "Dismiss basemap notice" }))
		rerender(<BasemapNotice messages={[]} />) // panned back into coverage
		act(() => void vi.advanceTimersByTime(REARM_DELAY_MS + 10))
		rerender(<BasemapNotice messages={[message]} />) // panned out again, long after
		expect(screen.getByRole("status")).toHaveTextContent("covers the United States only")
	})

	it("stays dismissed when the view only flickers across the coverage border", () => {
		vi.useFakeTimers()
		const { rerender } = render(<BasemapNotice messages={[message]} />)
		fireEvent.click(screen.getByRole("button", { name: "Dismiss basemap notice" }))
		rerender(<BasemapNotice messages={[]} />)
		act(() => void vi.advanceTimersByTime(400))
		rerender(<BasemapNotice messages={[message]} />)
		expect(screen.queryByRole("status")).toBeNull()
	})
})
