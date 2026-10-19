import type { MapLayer } from "@shared/proto/cline/map"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { restoredLayersNote, WorkspaceFilesSection } from "../WorkspaceFilesSection"

const mock = vi.hoisted(() => ({ list: vi.fn(), add: vi.fn() }))
vi.mock("../../../services/grpc-client", () => ({
	MapServiceClient: { listWorkspaceGeoFiles: mock.list, addWorkspaceGeoFile: mock.add },
}))

const file = (relativePath: string) => ({ relativePath, name: relativePath.split("/").pop(), extension: ".geojson" })
const styleProps = { fg: "#ddd", border: "#444", subtle: "#222" }

beforeEach(() => {
	mock.list.mockResolvedValue({ files: [file("a/one.geojson"), file("b/two.geojson")], totalCount: 2 })
	mock.add.mockResolvedValue({ layerId: "workspace_a_one_geojson" })
})
afterEach(() => {
	cleanup()
	mock.list.mockReset()
	mock.add.mockReset()
})

describe("WorkspaceFilesSection", () => {
	it("lists workspace files as candidates and registers nothing on its own", async () => {
		render(<WorkspaceFilesSection layers={[]} {...styleProps} />)
		await screen.findByRole("region", { name: "Workspace files you can add" })
		expect(screen.getByText("Workspace files you can add (2)")).toBeTruthy()
		expect(mock.add).not.toHaveBeenCalled()
	})

	it("adds exactly the file the user chose", async () => {
		render(<WorkspaceFilesSection layers={[]} {...styleProps} />)
		fireEvent.click(await screen.findByRole("button", { name: "Add a/one.geojson to the map" }))
		await waitFor(() => expect(mock.add).toHaveBeenCalledOnce())
		expect(mock.add.mock.calls[0][0].relativePath).toBe("a/one.geojson")
		await screen.findByText("Added one.geojson.")
	})

	it("does not list files already on the map", async () => {
		const onMap = [{ id: "workspace_a_one_geojson", name: "one.geojson", metadata: { path: "a/one.geojson" } }] as unknown as MapLayer[]
		render(<WorkspaceFilesSection layers={onMap} {...styleProps} />)
		await screen.findByText("Workspace files you can add (1)")
		expect(screen.queryByRole("button", { name: "Add a/one.geojson to the map" })).toBeNull()
	})

	it("says when the list is truncated, and renders nothing when the workspace has no geo files", async () => {
		mock.list.mockResolvedValue({ files: [file("a/one.geojson")], totalCount: 450 })
		const { unmount } = render(<WorkspaceFilesSection layers={[]} {...styleProps} />)
		await screen.findByText("Showing the first 1 of 450 files found.")
		unmount()
		mock.list.mockResolvedValue({ files: [], totalCount: 0 })
		const { container } = render(<WorkspaceFilesSection layers={[]} {...styleProps} />)
		await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(2))
		expect(container.textContent).toBe("")
	})
})

describe("restoredLayersNote", () => {
	const restored = (n: number, of: number) =>
		Array.from({ length: n }, (_, i) => ({ id: `l${i}`, metadata: { _hydrated: "1", _hydrated_of: String(of) } })) as unknown as MapLayer[]

	it("is null when nothing was restored", () => {
		expect(restoredLayersNote([{ id: "x", metadata: {} } as unknown as MapLayer])).toBeNull()
	})
	it("reports the restored count honestly when the cap dropped older layers", () => {
		expect(restoredLayersNote(restored(40, 118))).toBe("40 restored from earlier sessions (118 saved; only the most recent 40 were restored).")
	})
	it("reports a plain count when everything was restored", () => {
		expect(restoredLayersNote(restored(5, 5))).toBe("5 restored from earlier sessions.")
	})
})
