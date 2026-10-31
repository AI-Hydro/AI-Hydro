import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const saveRoiToWorkspace = vi.fn(() => Promise.resolve({ workspacePath: "roi/basin_a.json" }))
vi.mock("../../../services/grpc-client", () => ({
	MapServiceClient: {
		saveRoiToWorkspace: (...a: unknown[]) => (saveRoiToWorkspace as any)(...a),
		loadRoiFromWorkspace: vi.fn(),
	},
}))

import { MapRoiStrip } from "../MapRoiStrip"

afterEach(cleanup)

describe("ROI strip", () => {
	it("asks for the file name in the strip (window.prompt does nothing in a webview) and saves under it", async () => {
		const prompt = vi.spyOn(window, "prompt")
		render(<MapRoiStrip mapStyle="dark" roi={{ name: "Basin A" }} />)
		fireEvent.click(screen.getByRole("button", { name: "Save" }))
		const field = screen.getByLabelText("Save ROI as") as HTMLInputElement
		expect(field.value).toBe("Basin_A")
		fireEvent.change(field, { target: { value: "basin a" } })
		fireEvent.keyDown(field, { key: "Enter" })
		await waitFor(() => expect(saveRoiToWorkspace).toHaveBeenCalledTimes(1))
		expect((saveRoiToWorkspace.mock.calls[0] as any)[0].name).toBe("basin_a")
		expect(prompt).not.toHaveBeenCalled()
		await screen.findByText(/Saved roi\/basin_a.json/)
	})
})
