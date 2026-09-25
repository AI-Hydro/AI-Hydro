import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MAP_SYNC_TIMEOUT_MS, MapContextProvider, useMapContext } from "../MapContext"

const mock = vi.hoisted(() => ({
	layers: vi.fn(),
	session: vi.fn(),
	setActiveRoi: vi.fn(),
	getMapSession: vi.fn(),
	stopLayers: vi.fn(),
	stopSession: vi.fn(),
}))
vi.mock("@/services/grpc-client", () => ({
	MapServiceClient: {
		subscribeToMapLayers: mock.layers,
		subscribeToMapSession: mock.session,
		setActiveRoi: mock.setActiveRoi,
		getMapSession: mock.getMapSession,
	},
}))
let layerHandlers: any
let sessionHandlers: any
let context: ReturnType<typeof useMapContext>
beforeEach(() => {
	mock.layers.mockImplementation((_request, handlers) => {
		layerHandlers = handlers
		return mock.stopLayers
	})
	mock.session.mockImplementation((_request, handlers) => {
		sessionHandlers = handlers
		return mock.stopSession
	})
	mock.setActiveRoi.mockResolvedValue({})
	mock.getMapSession.mockResolvedValue({})
})
afterEach(() => {
	cleanup()
	vi.resetAllMocks()
	vi.useRealTimers()
})
function View() {
	const state = useMapContext()
	context = state
	return (
		<>
			<span data-testid="layers">{state.layers.map((l) => l.id).join(",")}</span>
			<span data-testid="roi">{state.activeRoi?.id ?? "none"}</span>
			<span data-testid="status">{state.connectionStatus}</span>
			<span>{state.connectionError}</span>
			<button onClick={state.reconnect}>Reconnect</button>
		</>
	)
}
const marker = (operation: string) => ({ id: "__map_sync__", metadata: { __operation: operation } })
const layer = (id: string) => ({ id, name: id, layerType: "polygon", geojson: "", metadata: {} })
function mount() {
	return render(
		<MapContextProvider>
			<View />
		</MapContextProvider>,
	)
}
function sync(ids: string[]) {
	act(() => {
		layerHandlers.onResponse(marker("snapshot_start"))
		ids.forEach((id) => layerHandlers.onResponse(layer(id)))
		layerHandlers.onResponse(marker("snapshot_complete"))
		sessionHandlers.onResponse({})
	})
}

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, resolve, reject }
}

function streamRoi(id: string) {
	act(() => sessionHandlers.onResponse({ activeRoi: { id, name: id, source: "test", geojson: "{}" } }))
}

describe("Map connection lifecycle", () => {
	it("stages snapshot before committing and applies live removal", () => {
		mount()
		act(() => {
			layerHandlers.onResponse(marker("snapshot_start"))
			layerHandlers.onResponse(layer("a"))
		})
		expect(screen.getByTestId("layers")).toBeEmptyDOMElement()
		act(() => {
			layerHandlers.onResponse(marker("snapshot_complete"))
			sessionHandlers.onResponse({})
		})
		expect(screen.getByTestId("layers")).toHaveTextContent("a")
		expect(screen.getByTestId("status")).toHaveTextContent("connected")
		act(() => layerHandlers.onResponse({ id: "a", metadata: { __operation: "remove" } }))
		expect(screen.getByTestId("layers")).toBeEmptyDOMElement()
	})
	it("preserves visible state on failed refresh and ignores old callbacks", async () => {
		mount()
		sync(["old"])
		const old = layerHandlers
		act(() => old.onError(new Error("offline")))
		expect(screen.getByTestId("status")).toHaveTextContent("stale")
		expect(screen.getByTestId("layers")).toHaveTextContent("old")
		fireEvent.click(screen.getByText("Reconnect"))
		await waitFor(() => expect(mock.layers).toHaveBeenCalledTimes(2))
		act(() => {
			layerHandlers.onResponse(marker("snapshot_start"))
			layerHandlers.onResponse(layer("partial"))
			layerHandlers.onError(new Error("failed"))
		})
		expect(screen.getByTestId("layers")).toHaveTextContent("old")
		act(() => old.onResponse(layer("late")))
		expect(screen.getByTestId("layers")).not.toHaveTextContent("late")
	})
	it("reconnect snapshot replaces stale removals, including empty state", () => {
		mount()
		sync(["old"])
		fireEvent.click(screen.getByText("Reconnect"))
		sync([])
		expect(screen.getByTestId("layers")).toBeEmptyDOMElement()
		expect(screen.getByTestId("status")).toHaveTextContent("connected")
	})
	it("times out instead of remaining indefinitely loading", () => {
		vi.useFakeTimers()
		mount()
		act(() => vi.advanceTimersByTime(MAP_SYNC_TIMEOUT_MS))
		expect(screen.getByTestId("status")).toHaveTextContent("stale")
		expect(mock.stopLayers).toHaveBeenCalled()
		expect(mock.stopSession).toHaveBeenCalled()
	})
	it("marks closed session stream stale and disposes on unmount", () => {
		const rendered = mount()
		sync([])
		act(() => sessionHandlers.onComplete())
		expect(screen.getByTestId("status")).toHaveTextContent("stale")
		rendered.unmount()
		expect(mock.stopLayers).toHaveBeenCalled()
		expect(mock.stopSession).toHaveBeenCalled()
	})
})

describe("Map ROI lifecycle", () => {
	it("serializes host mutations and lets a newer stream ROI survive their completions", async () => {
		const first = deferred<Record<string, never>>()
		const second = deferred<Record<string, never>>()
		mock.setActiveRoi.mockReset()
		mock.setActiveRoi.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
		mount()
		sync([])

		const firstMutation = context.setActiveRoiOnHost({ id: "first", name: "first" }, "{}")
		const secondMutation = context.setActiveRoiOnHost({ id: "second", name: "second" }, "{}")
		await waitFor(() => expect(mock.setActiveRoi).toHaveBeenCalledTimes(1))
		expect(mock.setActiveRoi.mock.calls[0][0].roi.id).toBe("first")

		streamRoi("canonical")
		first.resolve({})
		await firstMutation
		await waitFor(() => expect(mock.setActiveRoi).toHaveBeenCalledTimes(2))
		expect(mock.setActiveRoi.mock.calls[1][0].roi.id).toBe("second")
		expect(screen.getByTestId("roi")).toHaveTextContent("canonical")

		second.resolve({})
		await secondMutation
		expect(screen.getByTestId("roi")).toHaveTextContent("canonical")
	})

	it("continues the mutation queue after failure without fabricating selection", async () => {
		const failure = deferred<Record<string, never>>()
		mock.setActiveRoi.mockReset()
		mock.setActiveRoi.mockImplementationOnce(() => failure.promise).mockResolvedValueOnce({})
		mount()
		sync([])
		streamRoi("retained")

		const failedMutation = context.setActiveRoiOnHost({ id: "failed", name: "failed" }, "{}")
		const clearMutation = context.setActiveRoiOnHost(undefined)
		await waitFor(() => expect(mock.setActiveRoi).toHaveBeenCalledTimes(1))
		failure.reject(new Error("write failed"))
		await expect(failedMutation).rejects.toThrow("write failed")
		await clearMutation

		expect(mock.setActiveRoi).toHaveBeenCalledTimes(2)
		expect(mock.setActiveRoi.mock.calls[1][0].roi).toBeUndefined()
		expect(screen.getByTestId("roi")).toHaveTextContent("retained")
	})

	it("does not dispatch a queued mutation after unmount", async () => {
		const first = deferred<Record<string, never>>()
		mock.setActiveRoi.mockReset()
		mock.setActiveRoi.mockImplementationOnce(() => first.promise).mockResolvedValueOnce({})
		const rendered = mount()
		sync([])

		const firstMutation = context.setActiveRoiOnHost({ id: "first", name: "first" }, "{}")
		const queuedMutation = context.setActiveRoiOnHost({ id: "queued", name: "queued" }, "{}")
		const queuedRejection = expect(queuedMutation).rejects.toThrow("map connection changed")
		await waitFor(() => expect(mock.setActiveRoi).toHaveBeenCalledTimes(1))
		rendered.unmount()
		first.resolve({})

		await firstMutation
		await queuedRejection
		expect(mock.setActiveRoi).toHaveBeenCalledTimes(1)
	})

	it("does not dispatch a queued mutation through a reconnected session", async () => {
		const first = deferred<Record<string, never>>()
		mock.setActiveRoi.mockReset()
		mock.setActiveRoi.mockImplementationOnce(() => first.promise).mockResolvedValueOnce({})
		mount()
		sync([])

		const firstMutation = context.setActiveRoiOnHost({ id: "first", name: "first" }, "{}")
		const queuedMutation = context.setActiveRoiOnHost({ id: "queued", name: "queued" }, "{}")
		const queuedRejection = expect(queuedMutation).rejects.toThrow("map connection changed")
		await waitFor(() => expect(mock.setActiveRoi).toHaveBeenCalledTimes(1))
		fireEvent.click(screen.getByText("Reconnect"))
		await waitFor(() => expect(mock.session).toHaveBeenCalledTimes(2))
		first.resolve({})

		await firstMutation
		await queuedRejection
		expect(mock.setActiveRoi).toHaveBeenCalledTimes(1)
	})

	it("ignores a refresh response superseded by reconnect and a new session stream", async () => {
		const refresh = deferred<{ activeRoi: { id: string; name: string; source: string; geojson: string } }>()
		mock.getMapSession.mockReturnValueOnce(refresh.promise)
		mount()
		sync([])
		streamRoi("before")

		const pendingRefresh = context.refreshSessionRoi()
		const oldSession = sessionHandlers
		fireEvent.click(screen.getByText("Reconnect"))
		await waitFor(() => expect(mock.session).toHaveBeenCalledTimes(2))
		sync([])
		streamRoi("after")
		act(() => oldSession.onResponse({ activeRoi: { id: "old-stream", name: "old-stream", source: "test" } }))
		refresh.resolve({ activeRoi: { id: "stale", name: "stale", source: "test", geojson: "{}" } })
		await pendingRefresh

		expect(screen.getByTestId("roi")).toHaveTextContent("after")
	})

	it("ignores a refresh response superseded by a later mutation intent", async () => {
		const refresh = deferred<{ activeRoi: { id: string; name: string; source: string; geojson: string } }>()
		mock.getMapSession.mockReturnValueOnce(refresh.promise)
		mount()
		sync([])
		streamRoi("retained")

		const pendingRefresh = context.refreshSessionRoi()
		const mutation = context.setActiveRoiOnHost({ id: "requested", name: "requested" }, "{}")
		refresh.resolve({ activeRoi: { id: "stale", name: "stale", source: "test", geojson: "{}" } })
		await Promise.all([pendingRefresh, mutation])

		expect(screen.getByTestId("roi")).toHaveTextContent("retained")
	})

	it("ignores a refresh response after teardown", async () => {
		const refresh = deferred<{ activeRoi: { id: string; name: string; source: string; geojson: string } }>()
		mock.getMapSession.mockReturnValueOnce(refresh.promise)
		const rendered = mount()
		sync([])
		const pendingRefresh = context.refreshSessionRoi()
		rendered.unmount()

		refresh.resolve({ activeRoi: { id: "late", name: "late", source: "test", geojson: "{}" } })
		await pendingRefresh
		expect(screen.queryByTestId("roi")).not.toBeInTheDocument()
	})
})
