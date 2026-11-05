import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MapEmptyState, shouldShowEmptyState } from "../MapEmptyState"

const mock = vi.hoisted(() => ({ start: vi.fn(), post: vi.fn() }))
vi.mock("../mapAgentBridge", () => ({ startMapAgentTask: mock.start }))
vi.mock("../../../config/platform.config", () => ({ PLATFORM_CONFIG: { postMessage: mock.post } }))

afterEach(() => {
	cleanup()
	mock.start.mockReset()
	mock.post.mockReset()
})

describe("MapEmptyState", () => {
	it("offers three real buttons on an opaque card, with the agent action labelled as one", () => {
		render(<MapEmptyState onFindGauge={() => {}} />)
		const names = screen.getAllByRole("button").map((b) => b.textContent)
		expect(names).toEqual(["Open a file…", "Find a gauge", "Ask the agent: start a watershed investigation"])
		expect(screen.getByRole("region", { name: "No layers yet" })).toHaveClass("aih-empty")
	})

	it("contains no emoji and no styled-div actions", () => {
		const { container } = render(<MapEmptyState onFindGauge={() => {}} />)
		expect(container.textContent ?? "").not.toMatch(/\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u)
		expect(container.querySelectorAll(".map-empty-action").length).toBe(0)
	})

	it("asks the host to open its file picker, so the file arrives with its path", () => {
		render(<MapEmptyState onFindGauge={() => {}} />)
		fireEvent.click(screen.getByRole("button", { name: "Open a file…" }))
		expect(mock.post).toHaveBeenCalledWith({ type: "aihydro-map-add-file-command" })
		expect(screen.queryByLabelText("Choose map files")).toBeNull()
	})

	it("Find a gauge calls the focus-search handler", () => {
		const find = vi.fn()
		render(<MapEmptyState onFindGauge={find} />)
		fireEvent.click(screen.getByRole("button", { name: "Find a gauge" }))
		expect(find).toHaveBeenCalledOnce()
	})

	it("sends an outcome-free agent prompt and reports the result", async () => {
		mock.start.mockResolvedValue({ ok: true })
		render(<MapEmptyState onFindGauge={() => {}} />)
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

describe("shouldShowEmptyState", () => {
	it("shows only when the sync is complete, there are no layers and no panel is open", () => {
		expect(shouldShowEmptyState({ connectionStatus: "connected", layerCount: 0, panelOpen: false })).toBe(true)
	})
	it("never during the loading sync or when stale (an empty list says nothing then)", () => {
		expect(shouldShowEmptyState({ connectionStatus: "loading", layerCount: 0, panelOpen: false })).toBe(false)
		expect(shouldShowEmptyState({ connectionStatus: "stale", layerCount: 0, panelOpen: false })).toBe(false)
	})
	it("never while a tool panel is open", () => {
		expect(shouldShowEmptyState({ connectionStatus: "connected", layerCount: 0, panelOpen: true })).toBe(false)
	})
	it("never while the host is still restoring saved layers", () => {
		expect(shouldShowEmptyState({ connectionStatus: "connected", layerCount: 0, panelOpen: false, hydrating: true })).toBe(
			false,
		)
		expect(shouldShowEmptyState({ connectionStatus: "connected", layerCount: 0, panelOpen: false, hydrating: false })).toBe(
			true,
		)
	})
	it("never when there are layers", () => {
		expect(shouldShowEmptyState({ connectionStatus: "connected", layerCount: 3, panelOpen: false })).toBe(false)
	})
})
