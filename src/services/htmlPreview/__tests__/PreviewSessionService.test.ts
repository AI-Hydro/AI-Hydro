import { expect } from "chai"
import * as sinon from "sinon"
import { PreviewSessionService } from "../PreviewSessionService"

describe("PreviewSessionService observable module identity", () => {
	beforeEach(() => {
		sinon.stub(PreviewSessionService as any, "purgeDiskState").resolves()
		sinon.stub(PreviewSessionService.prototype as any, "mirrorEventToDisk").resolves()
		sinon.stub(PreviewSessionService.prototype as any, "mirrorSnapshotToDisk").resolves()
	})

	afterEach(() => sinon.restore())

	it("migrates pre-manifest registry and events into one canonical logical session", () => {
		const service = new PreviewSessionService()
		service.appendEvent({
			moduleId: "file_temporary",
			kind: "cell.registry",
			payloadJson: JSON.stringify({ moduleId: "file_temporary", cells: [{ cellId: "cell-1", language: "python" }] }),
		})
		service.appendEvent({
			moduleId: "file_temporary",
			cellId: "cell-1",
			kind: "cell.run.started",
			payloadJson: JSON.stringify({ moduleId: "file_temporary", cellId: "cell-1" }),
		})

		service.resolveModuleIdentity("file_temporary", "water-balance")
		service.appendEvent({
			moduleId: "water-balance",
			kind: "manifest.loaded",
			payloadJson: JSON.stringify({ id: "water-balance", moduleId: "water-balance", title: "Water balance" }),
		})

		expect(service.getAllModuleIds()).to.deep.equal(["water-balance"])
		expect(service.getSnapshot("water-balance")?.cells.map((cell) => cell.cellId)).to.deep.equal(["cell-1"])
		for (const event of service.getRecentEvents("water-balance")) {
			expect(event.moduleId).to.equal("water-balance")
			expect(JSON.parse(event.payloadJson).moduleId).to.equal("water-balance")
		}
	})

	it("tracks the currently implemented manifest, registry, execution, error, and interaction events", () => {
		const service = new PreviewSessionService()
		const kinds = [
			"manifest.loaded",
			"cell.registry",
			"cell.run.started",
			"cell.run.completed",
			"cell.error",
			"user.interaction",
		]
		for (const kind of kinds) {
			service.appendEvent({
				moduleId: "water-balance",
				cellId: kind.startsWith("cell.") ? "cell-1" : undefined,
				kind,
				payloadJson: JSON.stringify(
					kind === "manifest.loaded"
						? { moduleId: "water-balance", title: "Water balance" }
						: kind === "cell.registry"
							? { cells: [{ cellId: "cell-1", language: "python" }] }
							: { moduleId: "water-balance", message: "synthetic" },
				),
			})
		}

		expect(service.getRecentEvents("water-balance").map((event) => event.kind)).to.deep.equal(kinds)
		expect(service.getRecentEvents("water-balance").some((event) => event.kind.includes("progress"))).to.be.false
		expect(service.getSnapshot("water-balance")?.recentErrors).to.have.length(1)
	})
})

describe("PreviewSessionService archive-on-remove", () => {
	const fs = require("node:fs") as typeof import("node:fs")
	const os = require("node:os") as typeof import("node:os")
	const path = require("node:path") as typeof import("node:path")
	let dir: string

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "aihydro-archive-"))
		sinon.stub(PreviewSessionService as any, "purgeDiskState").resolves()
		sinon.stub(PreviewSessionService.prototype as any, "mirrorEventToDisk").resolves()
		sinon.stub(PreviewSessionService.prototype as any, "mirrorSnapshotToDisk").resolves()
		sinon.stub(PreviewSessionService.prototype as any, "removeDiskFiles").resolves()
	})
	afterEach(() => {
		sinon.restore()
		fs.rmSync(dir, { recursive: true, force: true })
	})

	function seeded(): PreviewSessionService {
		const service = new PreviewSessionService({ archiveDir: dir })
		service.appendEvent({ moduleId: "lab-1", cellId: "c1", kind: "cell.run.started", payloadJson: "{}" })
		service.appendEvent({ moduleId: "lab-1", cellId: "c1", kind: "cell.error", payloadJson: '{"message":"boom"}' })
		return service
	}

	it("clearModule archives the event history instead of silently deleting it", async () => {
		const service = seeded()
		service.clearModule("lab-1")
		await service.flush()
		expect(service.getAllModuleIds()).to.deep.equal([])
		const archives = await service.listArchives("lab-1")
		expect(archives).to.have.length(1)
		const archive = JSON.parse(fs.readFileSync(path.join(dir, "lab-1", archives[0]), "utf8"))
		expect(archive.events.map((e: any) => e.kind)).to.deep.equal(["cell.run.started", "cell.error"])
		expect(archive.reason).to.equal("preview removed")
	})

	it("clearAll archives every module", async () => {
		const service = seeded()
		service.appendEvent({ moduleId: "lab-2", kind: "cell.run.started", payloadJson: "{}" })
		service.clearAll()
		await service.flush()
		expect(await service.listArchives("lab-1")).to.have.length(1)
		expect(await service.listArchives("lab-2")).to.have.length(1)
	})

	it("does not archive a module that never recorded anything", async () => {
		const service = new PreviewSessionService({ archiveDir: dir })
		service.clearModule("never-used")
		await service.flush()
		expect(await service.listArchives("never-used")).to.deep.equal([])
	})
})
