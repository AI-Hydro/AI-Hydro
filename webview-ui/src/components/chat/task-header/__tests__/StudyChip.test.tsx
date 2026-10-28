import type { StudyBindingState } from "@shared/ExtensionMessage"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { StudyChipView, StudyPickerPanelView } from "../StudyChip"

afterEach(cleanup)

const CHAT = "01JCHAT"
const bound: StudyBindingState = {
	chatId: CHAT,
	status: "bound",
	studyId: "01031500",
	label: "Piscataquis River near Dover-Foxcroft, ME (USGS 01031500)",
	reason: "The map layer belongs to this study.",
	by: "map-layer",
	canChoose: true,
}
const choose: StudyBindingState = {
	chatId: CHAT,
	status: "choose",
	candidates: [
		{
			studyId: "01031500",
			label: "Piscataquis River near Dover-Foxcroft, ME (USGS 01031500)",
			lastRun: "2026-08-02T14:03:00Z",
		},
		{ studyId: "basin_45p1_69p3", label: "Outlet 45.10N 69.30W" },
	],
	reason: "2 studies in this folder. Pick one before the first run.",
	canChoose: true,
}

const handlers = () => ({ onOpen: vi.fn(), onChoose: vi.fn(), onDecline: vi.fn() })

describe("StudyChip (X0-2)", () => {
	it("renders nothing without a binding state", () => {
		const { container } = render(<StudyChipView binding={undefined} {...handlers()} />)
		expect(container).toBeEmptyDOMElement()
	})

	it("shows the bound study id first and its label, as a named button that opens the picker", () => {
		const h = handlers()
		render(<StudyChipView binding={bound} {...h} />)
		const chip = screen.getByRole("button", { name: /Study for this chat: 01031500 Piscataquis River/ })
		expect(chip.textContent).toContain("01031500")
		expect(chip.textContent).toContain("Piscataquis River near Dover-Foxcroft")
		expect(chip.textContent?.indexOf("01031500")).toBeLessThan(chip.textContent?.indexOf("Piscataquis") ?? 0)
		fireEvent.click(chip)
		expect(h.onOpen).toHaveBeenCalledTimes(1)
	})

	it("says a choice is pending when several studies could be meant, and never shows a study id for it", () => {
		render(<StudyChipView binding={choose} {...handlers()} />)
		const chip = screen.getByRole("button", { name: /Choose study/ })
		expect(chip).toHaveAttribute("aria-expanded", "true")
		expect(chip.textContent).not.toMatch(/01031500|basin_45p1/)
	})

	it("is read-only when the server cannot switch studies", () => {
		render(
			<StudyChipView
				binding={{ chatId: CHAT, status: "unavailable", reason: "old server", canChoose: false }}
				{...handlers()}
			/>,
		)
		expect(screen.queryByRole("button")).toBeNull()
		expect(screen.getByText("Study unavailable")).toBeInTheDocument()
	})

	it("shows 'No study' when nothing is bound", () => {
		render(<StudyChipView binding={{ chatId: CHAT, status: "none", canChoose: true }} {...handlers()} />)
		expect(screen.getByRole("button", { name: /No study/ })).toBeInTheDocument()
	})
})

describe("StudyPicker (X0-2)", () => {
	it("lists labelled candidates, chosen once with a click", () => {
		const h = handlers()
		render(<StudyPickerPanelView binding={choose} {...h} />)
		expect(screen.getByText("Outlet 45.10N 69.30W")).toBeInTheDocument()
		expect(screen.getByText(/last run 2026-08-02/)).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: /Outlet 45.10N 69.30W/ }))
		expect(h.onChoose).toHaveBeenCalledWith("basin_45p1_69p3")
		expect(h.onDecline).not.toHaveBeenCalled()
	})

	it("offers 'New study (delineate)' and 'No study' when nothing is bound, and binds neither", () => {
		const h = handlers()
		render(<StudyPickerPanelView binding={choose} {...h} />)
		fireEvent.click(screen.getByRole("button", { name: "New study (delineate)" }))
		fireEvent.click(screen.getByRole("button", { name: "No study" }))
		expect(h.onDecline.mock.calls).toEqual([["new"], ["none"]])
		expect(h.onChoose).not.toHaveBeenCalled()
	})

	it("in switch mode marks the current study and offers 'Keep current' instead of 'No study'", () => {
		const h = handlers()
		render(<StudyPickerPanelView binding={{ ...choose, studyId: "01031500", label: bound.label }} {...h} />)
		expect(screen.queryByRole("button", { name: "No study" })).toBeNull()
		expect(screen.getAllByRole("button").find((b) => b.getAttribute("aria-current") === "true")?.textContent).toContain(
			"Piscataquis",
		)
		fireEvent.click(screen.getByRole("button", { name: "Keep current" }))
		expect(h.onDecline).toHaveBeenCalledWith("none")
	})

	it("Escape closes without binding", () => {
		const h = handlers()
		render(<StudyPickerPanelView binding={choose} {...h} />)
		fireEvent.keyDown(screen.getByTestId("study-picker"), { key: "Escape" })
		expect(h.onDecline).toHaveBeenCalledWith("none")
		expect(h.onChoose).not.toHaveBeenCalled()
	})

	it("disables the choices when the server cannot switch studies", () => {
		render(<StudyPickerPanelView binding={{ ...choose, canChoose: false }} {...handlers()} />)
		expect(screen.getByRole("button", { name: /Outlet 45.10N/ })).toBeDisabled()
	})

	it("renders nothing unless the host opened it", () => {
		const { container } = render(<StudyPickerPanelView binding={bound} {...handlers()} />)
		expect(container).toBeEmptyDOMElement()
	})
})
