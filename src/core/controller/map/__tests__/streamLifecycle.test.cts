{
	const { expect } = require("chai")
	const Module = require("module")

	let cleanup: () => void
	const originalLoad = Module._load
	Module._load = function (name: string, ...args: unknown[]) {
		if (name === "@/core/controller/grpc-handler") {
			return {
				getRequestRegistry: () => ({
					registerRequest: (_id: string, fn: () => void) => {
						cleanup = fn
					},
				}),
			}
		}
		return originalLoad.call(this, name, ...args)
	}
	const { subscribeToMapLayers } = require("../subscribeToMapLayers")
	const { subscribeToMapSession } = require("../subscribeToMapSession")
	Module._load = originalLoad

	const layer = (id: string, metadata = {}) => ({ id, name: id, layerType: "polygon", metadata })
	describe("ordered map stream", () => {
		it("sends mutations after snapshot and disposes the controller listener", async () => {
			let listener: (value: any) => void = () => {}
			let disposed = 0
			const sent: string[] = []
			const controller = {
				subscribeToMapLayerUpdates(fn: typeof listener) {
					listener = fn
					return () => {
						disposed++
					}
				},
				getMapLayers: () => [layer("retained")],
			}
			await subscribeToMapLayers(
				controller,
				{},
				async (value: any) => {
					sent.push(value.metadata.__operation || value.id)
					if (value.metadata.__operation === "snapshot_start") listener(layer("retained", { __operation: "remove" }))
				},
				"test",
			)
			expect(sent).to.deep.equal(["snapshot_start", "retained", "snapshot_complete", "remove"])
			cleanup()
			listener(layer("late"))
			await Promise.resolve()
			expect(disposed).to.equal(1)
			expect(sent).not.to.include("late")
		})
		it("disposes on transport failure and stops sending snapshot", async () => {
			let disposed = 0
			let sends = 0
			await subscribeToMapLayers(
				{
					subscribeToMapLayerUpdates: () => () => {
						disposed++
					},
					getMapLayers: () => [layer("old")],
				},
				{},
				async () => {
					sends++
					throw new Error("fixture closed")
				},
				"test",
			)
			expect(disposed).to.equal(1)
			expect(sends).to.equal(1)
		})
	})

	describe("ordered map session stream", () => {
		it("serializes ROI updates behind initial delivery and retains empty visibility", async () => {
			let listener: (state: any) => void = () => {}
			let disposed = false
			let firstInFlight = false
			const order: string[] = []
			await subscribeToMapSession(
				{
					refreshMapSessionWorkspaceRoot: async () => {},
					getMapLayers: () => [],
					mapSessionService: {
						buildSnapshot: () => ({ activeRoi: { name: "initial" }, visibleLayerIds: ["old"] }),
						subscribeToSession: (fn: typeof listener) => {
							listener = fn
							return () => {
								disposed = true
							}
						},
					},
				},
				{},
				async (value: any) => {
					if (value.activeRoi.name === "initial") {
						firstInFlight = true
						listener({ activeRoi: { name: "new" }, visibleLayerIds: [] })
						await Promise.resolve()
						order.push("initial")
						firstInFlight = false
					} else {
						expect(firstInFlight).to.equal(false)
						expect(value.visibleLayerIds).to.deep.equal([])
						order.push("new")
					}
				},
				"session",
			)
			await Promise.resolve()
			await Promise.resolve()
			expect(order).to.deep.equal(["initial", "new"])
			cleanup()
			expect(disposed).to.equal(true)
		})
	})
}
