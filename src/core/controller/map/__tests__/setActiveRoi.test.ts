import { MapRoi, SetActiveRoiRequest } from "@shared/proto/cline/map"
import { expect } from "chai"
import * as fs from "fs/promises"
import { describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { MapSessionService } from "@/services/map/MapSessionService"
import type { Controller } from "../.."
import { setActiveRoi } from "../setActiveRoi"

describe("setActiveRoi handler ordering", () => {
	it("serializes workspace refresh and ROI mutation in invocation order", async () => {
		const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "map-roi-handler-"))
		try {
			const service = new MapSessionService({
				sessionFile: path.join(stateRoot, "map_session.json"),
				outboundEventsDir: path.join(stateRoot, "events"),
			})
			await service.initialize()
			let releaseFirstRefresh!: () => void
			const firstRefresh = new Promise<void>((resolve) => {
				releaseFirstRefresh = resolve
			})
			let refreshCalls = 0
			const controller = {
				mapSessionService: service,
				refreshMapSessionWorkspaceRoot: async () => {
					refreshCalls += 1
					if (refreshCalls === 1) await firstRefresh
				},
			} as unknown as Controller
			const first = setActiveRoi(
				controller,
				SetActiveRoiRequest.create({
					roi: MapRoi.create({
						id: "first",
						name: "First",
						source: "user",
						geojson: '{"type":"Point","coordinates":[0,0]}',
					}),
				}),
			)
			const second = setActiveRoi(controller, SetActiveRoiRequest.create({}))
			await Promise.resolve()
			await Promise.resolve()
			expect(refreshCalls).to.equal(1)

			releaseFirstRefresh()
			await Promise.all([first, second])

			expect(refreshCalls).to.equal(2)
			expect(service.getActiveRoi()).to.be.undefined
			expect(service.getRecentEvents().map((event) => event.type)).to.deep.equal(["roi.set", "roi.cleared"])
			await service.flushPersistence()
		} finally {
			await fs.rm(stateRoot, { recursive: true, force: true })
		}
	})
})
