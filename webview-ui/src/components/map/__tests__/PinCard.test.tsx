import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import PinCard, { type PinCardProps } from "../PinCard"
import { createPin } from "../pins"

afterEach(cleanup)

const pin = { ...createPin([], -69.5931, 45.4612), id: "pin_1", name: "Outlet candidate", notes: "check NLDI snap" }
const idle = { requested: 0, acked: 0, failed: 0, unscoped: false }
const props = (over: Partial<PinCardProps> = {}): PinCardProps => ({
	pin,
	mapStyle: "dark",
	onSave: vi.fn(() => 1),
	onRetry: vi.fn(() => 2),
	saveStatus: idle,
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

	it("saves name and note together on Enter in the name, and refuses an empty name", () => {
		const onSave = vi.fn(() => 1)
		render(<PinCard {...props({ onSave })} />)
		const input = screen.getByLabelText("Pin name") as HTMLInputElement
		fireEvent.change(input, { target: { value: "  Dam site  " } })
		fireEvent.keyDown(input, { key: "Enter" })
		expect(onSave).toHaveBeenCalledWith({ id: "pin_1", name: "Dam site", notes: "check NLDI snap" })
		onSave.mockClear()
		fireEvent.change(input, { target: { value: "   " } })
		fireEvent.keyDown(input, { key: "Enter" })
		expect(onSave).not.toHaveBeenCalled()
		expect(input.value).toBe("Outlet candidate")
	})

	it("keeps edits as a draft with an Unsaved changes line and a Save button, and saves on Ctrl+Enter in the note", () => {
		const onSave = vi.fn(() => 1)
		render(<PinCard {...props({ onSave })} />)
		expect(screen.queryByRole("button", { name: "Save" })).toBeNull()
		const note = screen.getByLabelText("Pin note")
		fireEvent.change(note, { target: { value: "upstream of the bridge" } })
		expect(onSave).not.toHaveBeenCalled()
		expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes")
		fireEvent.keyDown(note, { key: "Enter" })
		expect(onSave).not.toHaveBeenCalled() // a plain Enter is a new line
		fireEvent.keyDown(note, { key: "Enter", ctrlKey: true })
		expect(onSave).toHaveBeenCalledWith({ id: "pin_1", name: "Outlet candidate", notes: "upstream of the bridge" })
	})

	it("Save commits once, and Escape in a field throws its draft away", () => {
		const onSave = vi.fn(() => 1)
		render(<PinCard {...props({ onSave })} />)
		const note = screen.getByLabelText("Pin note") as HTMLTextAreaElement
		fireEvent.change(note, { target: { value: "x" } })
		fireEvent.keyDown(note, { key: "Escape" })
		expect(note.value).toBe("check NLDI snap")
		expect(screen.queryByRole("button", { name: "Save" })).toBeNull()
		fireEvent.change(note, { target: { value: "y" } })
		fireEvent.click(screen.getByRole("button", { name: "Save" }))
		expect(onSave).toHaveBeenCalledTimes(1)
	})

	it("commits an unsaved draft when focus leaves the card, and when the card closes", async () => {
		const onSave = vi.fn(() => 1)
		const { unmount } = render(
			<div>
				<PinCard {...props({ onSave })} />
				<button type="button">elsewhere</button>
			</div>,
		)
		const note = screen.getByLabelText("Pin note")
		note.focus()
		fireEvent.change(note, { target: { value: "left by blur" } })
		screen.getByRole("button", { name: "elsewhere" }).focus()
		await waitFor(() => expect(onSave).toHaveBeenCalledWith({ id: "pin_1", name: "Outlet candidate", notes: "left by blur" }))
		onSave.mockClear()
		fireEvent.change(note, { target: { value: "left by close" } })
		unmount()
		expect(onSave).toHaveBeenCalledWith({ id: "pin_1", name: "Outlet candidate", notes: "left by close" })
	})

	it("says Saved only after the host acknowledged that save, and Not saved with Retry when it did not", () => {
		const onRetry = vi.fn(() => 3)
		const { rerender } = render(<PinCard {...props({ onRetry, onSave: vi.fn(() => 2) })} />)
		fireEvent.change(screen.getByLabelText("Pin name"), { target: { value: "Dam" } })
		fireEvent.click(screen.getByRole("button", { name: "Save" }))
		const withStatus = (saveStatus: PinCardProps["saveStatus"]) =>
			rerender(<PinCard {...props({ onRetry, onSave: vi.fn(() => 2), saveStatus, pin: { ...pin, name: "Dam" } })} />)
		withStatus({ requested: 2, acked: 1, failed: 0, unscoped: false })
		expect(screen.getByRole("status")).toHaveTextContent("Saving")
		expect(screen.getByRole("status")).not.toHaveTextContent("Saved")
		withStatus({ requested: 2, acked: 2, failed: 0, unscoped: false })
		expect(screen.getByRole("status")).toHaveTextContent("Saved")
		withStatus({ requested: 2, acked: 1, failed: 2, unscoped: false })
		expect(screen.getByRole("status")).toHaveTextContent("Not saved to the project")
		fireEvent.click(screen.getByRole("button", { name: "Retry" }))
		expect(onRetry).toHaveBeenCalled()
	})

	it("is honest when the project is not known yet: on this device only, never Saved", () => {
		const { rerender } = render(
			<PinCard {...props({ onSave: vi.fn(() => "local" as const), saveStatus: { ...idle, unscoped: true } })} />,
		)
		fireEvent.change(screen.getByLabelText("Pin note"), { target: { value: "n" } })
		fireEvent.click(screen.getByRole("button", { name: "Save" }))
		rerender(<PinCard {...props({ saveStatus: { ...idle, unscoped: true }, pin: { ...pin, notes: "n" } })} />)
		expect(screen.getByRole("status")).toHaveTextContent("Saved on this device only")
		expect(screen.getByRole("status")).not.toHaveTextContent(/^Saved$/)
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

	it("a draft typed for pin A is saved onto A, not onto B, when the card switches without a focus change", () => {
		const onSave = vi.fn(() => 1)
		const b = { ...pin, id: "pin_2", name: "Dam", notes: "" }
		const { rerender } = render(<PinCard {...props({ onSave })} />)
		fireEvent.change(screen.getByLabelText("Pin note"), { target: { value: "for A only" } })
		rerender(<PinCard {...props({ onSave, pin: b })} />)
		expect(onSave).toHaveBeenCalledWith({ id: "pin_1", name: "Outlet candidate", notes: "for A only" })
		expect((screen.getByLabelText("Pin note") as HTMLTextAreaElement).value).toBe("")
	})
})
