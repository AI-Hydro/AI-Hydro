import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { MapConnectionStatus } from "../MapConnectionStatus"

afterEach(cleanup)
it("exposes stale data warning and actionable recovery", () => {
	const retry = vi.fn()
	render(<MapConnectionStatus error="Transport closed" onReconnect={retry} status="stale" />)
	expect(screen.getByRole("alert")).toHaveTextContent("Displayed layers may be out of date")
	expect(screen.getByRole("alert")).toHaveTextContent("Transport closed")
	fireEvent.click(screen.getByRole("button", { name: "Reconnect" }))
	expect(retry).toHaveBeenCalledOnce()
})
it("shows synchronization without implying readiness", () => {
	render(<MapConnectionStatus onReconnect={() => {}} status="loading" />)
	expect(screen.getByRole("status")).toHaveTextContent("Existing layers may be out of date")
})
it("removes warning after connection recovery", () => {
	const view = render(<MapConnectionStatus onReconnect={() => {}} status="stale" />)
	view.rerender(<MapConnectionStatus onReconnect={() => {}} status="connected" />)
	expect(screen.queryByRole("alert")).toBeNull()
	expect(screen.queryByRole("button")).toBeNull()
})
