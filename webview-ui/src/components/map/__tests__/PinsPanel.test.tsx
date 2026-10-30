import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import PinsPanel, { type PinsPanelProps } from "../PinsPanel"
import { createPin } from "../pins"

afterEach(cleanup)

const a = { ...createPin([], -69.5, 45.4), id: "a", name: "Pin 1" }
const b = { ...createPin([a], -70.1, 44.2), id: "b", name: "Dam" }
const props = (over: Partial<PinsPanelProps> = {}): PinsPanelProps => ({
	pins: [a, b],
	selectedId: null,
	toolArmed: false,
	mapStyle: "dark",
	importedCount: 0,
	onToggleTool: vi.fn(),
	onSelect: vi.fn(),
	onZoomTo: vi.fn(),
	onRename: vi.fn(),
	onDelete: vi.fn(),
	onClearAll: vi.fn(),
	onKeepImported: vi.fn(),
	onClearImported: vi.fn(),
	...over,
})

describe("pins panel", () => {
	it("lists pins with name and coordinates, and says how to add one", () => {
		render(<PinsPanel {...props()} />)
		const list = screen.getByRole("list", { name: "Pins" })
		expect(within(list).getAllByRole("listitem")).toHaveLength(2)
		expect(within(list).getByText("Dam")).toBeTruthy()
		expect(screen.getByText(/Press P, then click the map/)).toBeTruthy()
		expect(document.body.textContent).not.toMatch(/annotation/i)
	})

	it("selects, zooms to, renames and deletes", () => {
		const p = props()
		render(<PinsPanel {...p} />)
		fireEvent.click(screen.getByRole("button", { name: "Open pin Dam" }))
		const choose = (pin: string, item: string) => {
			fireEvent.click(screen.getByRole("button", { name: `Actions for ${pin}` }))
			fireEvent.click(screen.getByRole("menuitem", { name: item }))
		}
		choose("Dam", "Zoom to pin")
		choose("Dam", "Rename")
		const input = screen.getByLabelText("Pin name")
		fireEvent.change(input, { target: { value: "Weir" } })
		fireEvent.keyDown(input, { key: "Enter" })
		choose("Pin 1", "Delete pin")
		expect(p.onSelect).toHaveBeenCalledWith("b")
		expect(p.onZoomTo).toHaveBeenCalledWith("b")
		expect(p.onRename).toHaveBeenCalledWith("b", "Weir")
		expect(p.onDelete).toHaveBeenCalledWith("a")
	})

	it("asks before clearing all, and cancel clears nothing", () => {
		const p = props()
		render(<PinsPanel {...p} />)
		const clearAll = () => {
			fireEvent.click(screen.getByRole("button", { name: "Pins panel actions" }))
			fireEvent.click(screen.getByRole("menuitem", { name: "Clear all pins…" }))
		}
		clearAll()
		expect(p.onClearAll).not.toHaveBeenCalled()
		const dialog = screen.getByRole("alertdialog", { name: "Clear all pins" })
		fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
		expect(p.onClearAll).not.toHaveBeenCalled()
		clearAll()
		fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Clear all" }))
		expect(p.onClearAll).toHaveBeenCalledTimes(1)
	})

	it("arms the pin tool with a toggle button", () => {
		const p = props({ toolArmed: true })
		render(<PinsPanel {...p} />)
		const add = screen.getByRole("button", { name: "Add pin" })
		expect(add.getAttribute("aria-pressed")).toBe("true")
		fireEvent.click(add)
		expect(p.onToggleTool).toHaveBeenCalled()
	})

	it("offers Keep / Clear for pins imported from before projects", () => {
		const p = props({ importedCount: 2 })
		render(<PinsPanel {...p} />)
		expect(screen.getByText(/2 pins from before projects were moved into this project/)).toBeTruthy()
		fireEvent.click(screen.getByRole("button", { name: "Keep" }))
		fireEvent.click(screen.getByRole("button", { name: "Clear them" }))
		// Clearing the imported pins asks first: the pre-project list cannot be claimed again.
		expect(p.onClearImported).not.toHaveBeenCalled()
		fireEvent.click(
			within(screen.getByRole("alertdialog", { name: "Clear imported pins" })).getByRole("button", { name: "Cancel" }),
		)
		expect(p.onClearImported).not.toHaveBeenCalled()
		fireEvent.click(screen.getByRole("button", { name: "Clear them" }))
		fireEvent.click(screen.getByRole("button", { name: "Yes, clear" }))
		expect(p.onKeepImported).toHaveBeenCalled()
		expect(p.onClearImported).toHaveBeenCalledTimes(1)
	})

	it("shows an empty state", () => {
		render(<PinsPanel {...props({ pins: [] })} />)
		expect(screen.getByText("No pins yet.")).toBeTruthy()
		fireEvent.click(screen.getByRole("button", { name: "Pins panel actions" }))
		expect(screen.getByRole("menuitem", { name: /Clear all pins/ })).toHaveAttribute("aria-disabled", "true")
	})
})
