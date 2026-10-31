import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../services/grpc-client", () => ({ MapServiceClient: {}, FileServiceClient: {} }))

import { AnnotationsPanel } from "../AnnotationsPanel"
import { newAnnotation } from "../annotationStorage"
import { TRACKER_EXTRAS_KEY, trackerExtrasEnabled } from "../trackerExtras"

const sketch = () => ({
	...newAnnotation(
		"polygon",
		{
			type: "Polygon",
			coordinates: [
				[
					[0, 0],
					[1, 0],
					[1, 1],
					[0, 0],
				],
			],
		} as never,
		[],
	),
	status: "in-progress" as const,
	priority: "high" as const,
	tags: ["basin"],
})

const panel = () => (
	<AnnotationsPanel annotations={[sketch()]} onFlyTo={vi.fn()} onStartDrawing={vi.fn()} setAnnotations={vi.fn()} />
)

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe("Sketches panel", () => {
	it("hides the tracker (collections, search, status, priority, gallery, batch) by default and keeps the data", () => {
		const { container } = render(panel())
		expect(screen.queryByText(/\+ Collection/)).toBeNull()
		expect(screen.queryByPlaceholderText(/Search name, notes, tags/)).toBeNull()
		expect(screen.queryByText(/Save to My Gallery/)).toBeNull()
		expect(screen.queryByText(/Batch Ask Agent/)).toBeNull()
		expect(container.textContent).not.toMatch(/#basin|In Progress|High/)
		expect(trackerExtrasEnabled()).toBe(false)
	})

	it("shows the tracker again from the Sketches menu, and remembers the choice", () => {
		render(panel())
		fireEvent.click(screen.getByRole("button", { name: "Sketches actions" }))
		fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Tracker fields" }))
		expect(localStorage.getItem(TRACKER_EXTRAS_KEY)).toBe("1")
		expect(screen.getByText(/\+ Collection/)).toBeInTheDocument()
		expect(screen.getByText(/Save to My Gallery/)).toBeInTheDocument()
		expect(screen.getByText(/Batch Ask Agent/)).toBeInTheDocument()
	})
})
