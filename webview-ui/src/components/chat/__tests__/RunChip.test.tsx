import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { RunChip } from "../RunChip"

describe("RunChip", () => {
	it("is a neutral reference, never styled or worded as verified", () => {
		const { container } = render(<RunChip jsonPath="outputs.nse" runId="run.abc123" />)
		const button = container.querySelector("button")
		expect(button?.className).not.toContain("testing-iconPassed")
		expect(button?.querySelector(".codicon-check")).toBeNull()
		expect(screen.getByText("· run reference")).toBeTruthy()
		expect(container.textContent?.toLowerCase()).not.toContain("verified")
	})

	it("popover does not claim auditor verification", () => {
		const { container } = render(<RunChip jsonPath="outputs.nse" runId="run.abc123" />)
		fireEvent.click(container.querySelector("button") as HTMLElement)
		expect(container.textContent).toContain("Unverified reference")
		expect(container.textContent).not.toContain("verified by Answer Auditor")
	})
})
