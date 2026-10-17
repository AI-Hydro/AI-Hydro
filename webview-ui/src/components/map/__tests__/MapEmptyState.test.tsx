import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MapEmptyState } from "../MapEmptyState"

const mock = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock("../mapAgentBridge", () => ({ startMapAgentTask: mock.start }))

afterEach(() => {
	cleanup()
	mock.start.mockReset()
})

describe("MapEmptyState", () => {
	it("offers three real buttons on an opaque card, with the agent action labelled as one", () => {
		render(<MapEmptyState onFilesPicked={() => {}} onFindGauge={() => {}} />)
		const names = screen.getAllByRole("button").map((b) => b.textContent)
		expect(names).toEqual(["Open a file…", "Find a gauge", "Ask the agent: start a watershed investigation"])
		expect(screen.getByRole("region", { name: "No layers yet" })).toHaveClass("aih-empty")
	})

	it("contains no emoji and no styled-div actions", () => {
		const { container } = render(<MapEmptyState onFilesPicked={() => {}} onFindGauge={() => {}} />)
		expect(container.textContent ?? "").not.toMatch(/\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u)
		expect(container.querySelectorAll(".map-empty-action").length).toBe(0)
	})

	it("opens the file picker and passes the chosen files to the shared load path", () => {
		const picked = vi.fn()
		render(<MapEmptyState onFilesPicked={picked} onFindGauge={() => {}} />)
		const input = screen.getByLabelText("Choose map files") as HTMLInputElement
		const click = vi.spyOn(input, "click")
		fireEvent.click(screen.getByRole("button", { name: "Open a file…" }))
		expect(click).toHaveBeenCalledOnce()
		const file = new File(["{}"], "basin.geojson", { type: "application/geo+json" })
		fireEvent.change(input, { target: { files: [file] } })
		expect(picked).toHaveBeenCalledOnce()
	})

	it("Find a gauge calls the focus-search handler", () => {
		const find = vi.fn()
		render(<MapEmptyState onFilesPicked={() => {}} onFindGauge={find} />)
		fireEvent.click(screen.getByRole("button", { name: "Find a gauge" }))
		expect(find).toHaveBeenCalledOnce()
	})

	it("sends an outcome-free agent prompt and reports the result", async () => {
		mock.start.mockResolvedValue({ ok: true })
		render(<MapEmptyState onFilesPicked={() => {}} onFindGauge={() => {}} />)
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /Ask the agent/ }))
		})
		expect(mock.start).toHaveBeenCalledOnce()
		const prompt = mock.start.mock.calls[0][0] as string
		expect(prompt).toMatch(/stop and ask/i)
		expect(prompt).not.toMatch(/\d/)
		await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Agent task started"))
	})
})
