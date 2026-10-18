import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PlanActSwitch } from "../PlanActSwitch"

afterEach(cleanup)

function Harness({ onToggle }: { onToggle: (o?: { keepFocus?: boolean }) => void }) {
	const [mode, setMode] = useState<"plan" | "act">("plan")
	return (
		<PlanActSwitch
			mode={mode}
			onToggle={(o) => {
				onToggle(o)
				setMode((m) => (m === "plan" ? "act" : "plan"))
			}}
		/>
	)
}

describe("PlanActSwitch", () => {
	it("is a radiogroup with two radios and a roving tabindex", () => {
		render(<Harness onToggle={vi.fn()} />)
		expect(screen.getByRole("radiogroup")).toBeInTheDocument()
		const plan = screen.getByRole("radio", { name: "Plan" })
		const act = screen.getByRole("radio", { name: "Act" })
		expect(plan).toHaveAttribute("aria-checked", "true")
		expect(act).toHaveAttribute("aria-checked", "false")
		expect(plan).toHaveAttribute("tabindex", "0")
		expect(act).toHaveAttribute("tabindex", "-1")
	})

	it("arrow keys switch mode, move focus and keep it on the switch", () => {
		const onToggle = vi.fn()
		render(<Harness onToggle={onToggle} />)
		const plan = screen.getByRole("radio", { name: "Plan" })
		const act = screen.getByRole("radio", { name: "Act" })
		plan.focus()
		fireEvent.keyDown(plan, { key: "ArrowRight" })
		expect(onToggle).toHaveBeenCalledWith({ keepFocus: true })
		expect(act).toHaveAttribute("aria-checked", "true")
		expect(act).toHaveAttribute("tabindex", "0")
		expect(document.activeElement).toBe(act)
		fireEvent.keyDown(act, { key: "ArrowLeft" })
		expect(plan).toHaveAttribute("aria-checked", "true")
		expect(document.activeElement).toBe(plan)
		// Already on the first option: ArrowLeft does not toggle.
		fireEvent.keyDown(plan, { key: "ArrowLeft" })
		expect(onToggle).toHaveBeenCalledTimes(2)
	})

	it("clicking the inactive option switches; clicking the active one does nothing", () => {
		const onToggle = vi.fn()
		render(<Harness onToggle={onToggle} />)
		fireEvent.click(screen.getByRole("radio", { name: "Plan" }), { detail: 1 })
		expect(onToggle).not.toHaveBeenCalled()
		fireEvent.click(screen.getByRole("radio", { name: "Act" }), { detail: 1 })
		expect(onToggle).toHaveBeenCalledWith(undefined)
		expect(screen.getByRole("radio", { name: "Act" })).toHaveAttribute("aria-checked", "true")
	})
})
