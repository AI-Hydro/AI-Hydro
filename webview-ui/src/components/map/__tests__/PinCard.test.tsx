import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import PinCard, { type PinCardProps } from "../PinCard"
import { createPin } from "../pins"

afterEach(cleanup)

const pin = { ...createPin([], -69.5931, 45.4612), id: "pin_1", name: "Outlet candidate", notes: "check NLDI snap" }
const props = (over: Partial<PinCardProps> = {}): PinCardProps => ({
	pin,
	mapStyle: "dark",
	onRename: vi.fn(),
	onNote: vi.fn(),
	onAsk: vi.fn(),
	onDelineate: vi.fn(),
	onCopy: vi.fn(),
	onDelete: vi.fn(),
	onClose: vi.fn(),
	...over,
})

describe("pin card", () => {
	it("shows name, note, coordinates and the four actions, and nothing internal", () => {
		const { container } = render(<PinCard {...props()} />)
		expect((screen.getByLabelText("Pin name") as HTMLInputElement).value).toBe("Outlet candidate")
		expect((screen.getByLabelText("Pin note") as HTMLTextAreaElement).value).toBe("check NLDI snap")
		expect(screen.getByText("45.46120°N, 69.59310°W")).toBeTruthy()
		for (const name of ["Ask AI-Hydro", "Delineate here", "Copy coordinates", "Delete"]) {
			expect(screen.getByRole("button", { name })).toBeTruthy()
		}
		const text = container.textContent ?? ""
		expect(text).not.toContain("__annotations-overlay")
		expect(text).not.toMatch(/#[0-9a-f]{6}/i)
		expect(text).not.toMatch(/\bcolor\b/i)
		expect(container.innerHTML).not.toContain("__annotations-overlay")
		expect(screen.getByRole("dialog", { name: "Pin: Outlet candidate" })).toBeTruthy()
	})

	it("renames inline on Enter, and refuses an empty name", () => {
		const onRename = vi.fn()
		render(<PinCard {...props({ onRename })} />)
		const input = screen.getByLabelText("Pin name") as HTMLInputElement
		fireEvent.change(input, { target: { value: "  Dam site  " } })
		fireEvent.keyDown(input, { key: "Enter" })
		expect(onRename).toHaveBeenCalledWith("Dam site")
		onRename.mockClear()
		fireEvent.change(input, { target: { value: "   " } })
		fireEvent.blur(input)
		expect(onRename).not.toHaveBeenCalled()
		expect(input.value).toBe("Outlet candidate")
	})

	it("saves the note when the field loses focus", () => {
		const onNote = vi.fn()
		render(<PinCard {...props({ onNote })} />)
		const note = screen.getByLabelText("Pin note")
		fireEvent.change(note, { target: { value: "upstream of the bridge" } })
		fireEvent.blur(note)
		expect(onNote).toHaveBeenCalledWith("upstream of the bridge")
	})

	it("wires the actions", () => {
		const p = props()
		render(<PinCard {...p} />)
		fireEvent.click(screen.getByRole("button", { name: "Ask AI-Hydro" }))
		fireEvent.click(screen.getByRole("button", { name: "Delineate here" }))
		fireEvent.click(screen.getByRole("button", { name: "Copy coordinates" }))
		fireEvent.click(screen.getByRole("button", { name: "Delete" }))
		fireEvent.click(screen.getByRole("button", { name: "Close pin card" }))
		expect(p.onAsk).toHaveBeenCalled()
		expect(p.onDelineate).toHaveBeenCalled()
		expect(p.onCopy).toHaveBeenCalled()
		expect(p.onDelete).toHaveBeenCalled()
		expect(p.onClose).toHaveBeenCalled()
	})

	it("focuses the name field for a pin just placed", () => {
		render(<PinCard {...props({ focusName: true })} />)
		expect(document.activeElement).toBe(screen.getByLabelText("Pin name"))
	})
})
