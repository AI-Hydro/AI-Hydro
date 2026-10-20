import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { BasemapNotice } from "../BasemapNotice"

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

it("re-arms a dismissed notice when its condition clears and later returns", () => {
	const message = { key: "coverage:usgs-topo", text: "USGS Topo covers the United States only, so no tiles are shown here." }
	const { rerender } = render(<BasemapNotice messages={[message]} />)
	fireEvent.click(screen.getByRole("button", { name: "Dismiss basemap notice" }))
	expect(screen.queryByRole("status")).toBeNull()
	rerender(<BasemapNotice messages={[]} />) // panned back into coverage
	rerender(<BasemapNotice messages={[message]} />) // panned out again
	expect(screen.getByRole("status")).toHaveTextContent("covers the United States only")
})
