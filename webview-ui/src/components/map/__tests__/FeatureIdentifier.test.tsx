import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import FeatureIdentifier, { type ClickedFeature } from "../FeatureIdentifier"

afterEach(cleanup)

const feature = (name: string): ClickedFeature => ({ layerId: name, layerName: name, properties: { name } })

describe("feature identifier card", () => {
	it("steps between features and closes with named codicon buttons, no glyph characters", () => {
		const onClose = vi.fn()
		const { container } = render(
			<FeatureIdentifier
				features={[feature("Basin A"), feature("Basin B")]}
				inspectPoint={{ lon: -69.5, lat: 45.4 }}
				mapStyle="dark"
				onClose={onClose}
			/>,
		)
		expect(screen.getByTitle("Basin A")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Next feature" }))
		expect(screen.getByTitle("Basin B")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Previous feature" }))
		expect(screen.getByTitle("Basin A")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Close inspector" }))
		expect(onClose).toHaveBeenCalled()
		expect(container.textContent ?? "").not.toMatch(/[‹›✕✏]/u)
		for (const b of container.querySelectorAll("button")) {
			expect(b.getAttribute("style") ?? "").not.toMatch(/(width|height): (1\d|2[0-3])px/)
		}
	})
})
