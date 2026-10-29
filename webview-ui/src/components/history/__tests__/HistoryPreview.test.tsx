import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import HistoryPreview from "../HistoryPreview"

const mock = vi.hoisted(() => ({
	show: vi.fn(async () => ({})),
	state: {
		taskHistory: [
			{
				id: "t1",
				ts: Date.UTC(2026, 9, 1, 15, 30),
				task: "**Delineate** the catchment for `SYN-1` and [signatures](run:fx-run-1)",
				tokensIn: 184200,
				tokensOut: 9640,
				cacheWrites: 42100,
				totalCost: 0.4812,
				isFavorited: true,
			},
		] as Array<Record<string, unknown>>,
	},
}))
vi.mock("@/services/grpc-client", () => ({ TaskServiceClient: { showTaskWithId: mock.show } }))
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => mock.state }))

afterEach(() => {
	cleanup()
	mock.show.mockClear()
})

describe("HistoryPreview", () => {
	it("names a chat that has no title from its prompt in plain text, as a real button that opens the task", () => {
		render(<HistoryPreview showHistoryView={() => {}} />)
		const title = screen.getByRole("button", { name: "Delineate the catchment for SYN-1 and signatures" })
		fireEvent.click(title)
		expect(mock.show).toHaveBeenCalledOnce()
		expect(document.body.textContent).not.toContain("**")
		expect(document.body.textContent).not.toContain("](")
	})

	it("shows the chat's stored title, never the raw prompt", () => {
		mock.state.taskHistory[0] = { ...mock.state.taskHistory[0], title: "Catchment signatures", titleSource: "auto" }
		render(<HistoryPreview showHistoryView={() => {}} />)
		expect(screen.getByRole("button", { name: "Catchment signatures" })).toBeInTheDocument()
		expect(document.body.textContent).not.toContain("Delineate")
		delete mock.state.taskHistory[0].title
		delete mock.state.taskHistory[0].titleSource
	})

	it("moves tokens and cost into a collapsed Usage disclosure", () => {
		render(<HistoryPreview showHistoryView={() => {}} />)
		expect(screen.queryByText("$0.4812")).toBeNull()
		const usage = screen.getByRole("button", { name: "Usage" })
		expect(usage).toHaveAttribute("aria-expanded", "false")
		fireEvent.click(usage)
		const region = screen.getByRole("region", { name: "Usage" })
		expect(within(region).getByText("$0.4812")).toBeInTheDocument()
		expect(within(region).getByText("184.2k")).toBeInTheDocument()
	})

	it("says there is no investigation record rather than inventing one", () => {
		render(<HistoryPreview showHistoryView={() => {}} />)
		expect(screen.getByText("Investigation record not linked yet")).toBeInTheDocument()
	})
})
