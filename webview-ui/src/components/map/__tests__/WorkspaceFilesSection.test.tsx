import type { MapLayer } from "@shared/proto/cline/map"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { restoredLayersNote, useWorkspaceCandidates, WorkspaceFilePicker } from "../WorkspaceFilesSection"

const mock = vi.hoisted(() => ({ list: vi.fn(), add: vi.fn() }))
vi.mock("../../../services/grpc-client", () => ({
	MapServiceClient: { listWorkspaceGeoFiles: mock.list, addWorkspaceGeoFile: mock.add },
}))

const file = (relativePath: string, workspaceFolder = "/ws", folderName = "ws") => ({
	relativePath,
	workspaceFolder,
	folderName,
	name: relativePath.split("/").pop(),
	extension: ".geojson",
})
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

/** The hook and the picker together, as the Layers panel uses them. */
const Harness: React.FC<{ layers: MapLayer[]; onStatus?: (kind: "ok" | "err", msg: string) => void }> = ({
	layers,
	onStatus = () => {},
}) => {
	const ws = useWorkspaceCandidates(layers)
	const [open, setOpen] = React.useState(false)
	return (
		<div>
			<span data-testid="count">{ws.addable.length}</span>
			<button onClick={() => setOpen(true)} type="button">
				open
			</button>
			{open && (
				<WorkspaceFilePicker
					addable={ws.addable}
					files={ws.files}
					onClose={() => setOpen(false)}
					onStatus={onStatus}
					totalCount={ws.totalCount}
					{...styleProps}
				/>
			)}
		</div>
	)
}
const openPicker = async (n: string) => {
	await waitFor(() => expect(screen.getByTestId("count").textContent).toBe(n))
	fireEvent.click(screen.getByRole("button", { name: "open" }))
}

describe("workspace file candidates", () => {
	it("count what can be added, and register nothing on their own", async () => {
		render(<Harness layers={[]} />)
		await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("2"))
		expect(mock.add).not.toHaveBeenCalled()
		expect(screen.queryByRole("region", { name: "From this workspace" })).toBeNull()
	})

	it("adds exactly the file the user chose, and reports through the expiring status, not a line of its own", async () => {
		const onStatus = vi.fn()
		render(<Harness layers={[]} onStatus={onStatus} />)
		await openPicker("2")
		fireEvent.click(screen.getByRole("button", { name: "Add a/one.geojson to the map" }))
		await waitFor(() => expect(mock.add).toHaveBeenCalledOnce())
		expect(mock.add.mock.calls[0][0].relativePath).toBe("a/one.geojson")
		await waitFor(() => expect(onStatus).toHaveBeenCalledWith("ok", "Added one.geojson."))
		expect(screen.queryByText("Added one.geojson.")).toBeNull()
	})

	it("do not list a file already on the map by any route: workspace layer, or a user-added layer with the same path", async () => {
		const onMap = [
			{
				id: "workspace_a_one_geojson",
				name: "one.geojson",
				metadata: { source: "workspace", path: "a/one.geojson", workspace_folder: "/ws" },
			},
			{ id: "polygon-17-x", name: "two", metadata: { source: "user", source_path: "/ws/b/two.geojson" } },
		] as unknown as MapLayer[]
		render(<Harness layers={onMap} />)
		await waitFor(() => expect(mock.list).toHaveBeenCalled())
		await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("0"))
	})

	it("key multi-root files by folder plus path: the same relative path in two folders stays two rows", async () => {
		mock.list.mockResolvedValue({
			files: [file("data/basin.geojson", "/one", "one"), file("data/basin.geojson", "/two", "two")],
			totalCount: 2,
		})
		const onMap = [
			{ id: "workspace_one_data", name: "basin", metadata: { path: "data/basin.geojson", workspace_folder: "/one" } },
		] as unknown as MapLayer[]
		render(<Harness layers={onMap} />)
		await openPicker("1")
		fireEvent.click(screen.getByRole("button", { name: "Add data/basin.geojson to the map" }))
		await waitFor(() => expect(mock.add).toHaveBeenCalledOnce())
		expect(mock.add.mock.calls[0][0]).toMatchObject({ relativePath: "data/basin.geojson", workspaceFolder: "/two" })
		expect(screen.getByText(/two \//)).toBeTruthy()
	})

	it("says when the list is truncated, and offers nothing when the workspace has no geo files", async () => {
		mock.list.mockResolvedValue({ files: [file("a/one.geojson")], totalCount: 450 })
		const { unmount } = render(<Harness layers={[]} />)
		await openPicker("1")
		await screen.findByText("Showing the first 1 of 450 files found.")
		unmount()
		mock.list.mockResolvedValue({ files: [], totalCount: 0 })
		render(<Harness layers={[]} />)
		await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(2))
		expect(screen.getByTestId("count").textContent).toBe("0")
	})
})

describe("restoredLayersNote", () => {
	const restored = (n: number, of: number) =>
		Array.from({ length: n }, (_, i) => ({
			id: `l${i}`,
			metadata: { _hydrated: "1", _hydrated_of: String(of) },
		})) as unknown as MapLayer[]

	it("is null when nothing was restored", () => {
		expect(restoredLayersNote([{ id: "x", metadata: {} } as unknown as MapLayer])).toBeNull()
	})
	it("reports the restored count honestly when the cap dropped older layers", () => {
		expect(restoredLayersNote(restored(40, 118))).toBe(
			"40 restored from earlier sessions. 78 older saved layers are kept but not loaded.",
		)
	})
	it("uses the host's authoritative older count, and reports it even when nothing is restored", () => {
		expect(restoredLayersNote(restored(40, 118), 1)).toBe(
			"40 restored from earlier sessions. 1 older saved layer is kept but not loaded.",
		)
		expect(restoredLayersNote([], 78)).toBe("78 older saved layers are kept but not loaded.")
		expect(restoredLayersNote(restored(5, 5), 0)).toBe("5 restored from earlier sessions.")
	})
	it("reports a plain count when everything was restored", () => {
		expect(restoredLayersNote(restored(5, 5))).toBe("5 restored from earlier sessions.")
	})
})
