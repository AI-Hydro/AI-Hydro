import { MapRoi, MapSessionView } from "@shared/proto/cline/map"
import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { type MapSessionPersistenceIo, MapSessionService } from "../MapSessionService"

describe("MapSessionService", () => {
	const tmpRoots: string[] = []

	async function createService(workspaceRoot?: string) {
		const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "map-session-state-"))
		tmpRoots.push(stateRoot)
		const svc = new MapSessionService({
			workspaceRoot,
			sessionFile: path.join(stateRoot, "map_session.json"),
			outboundEventsDir: path.join(stateRoot, "events"),
		})
		await svc.initialize()
		return { svc, stateRoot }
	}

	afterEach(async () => {
		for (const root of tmpRoots) {
			await fs.rm(root, { recursive: true, force: true })
		}
		tmpRoots.length = 0
	})

	it("setActiveRoi and clearActiveRoi update snapshot", async () => {
		const { svc } = await createService("/tmp/ws")
		svc.setActiveRoi(
			MapRoi.create({
				id: "r1",
				name: "Test basin",
				source: "map_draw",
				geojson: '{"type":"FeatureCollection","features":[]}',
				areaHa: 100,
				workspacePath: "",
			}),
			"user",
		)
		expect(svc.getActiveRoi()?.name).to.equal("Test basin")
		svc.clearActiveRoi("user")
		expect(svc.getActiveRoi()).to.be.undefined
		await svc.flushPersistence()
	})

	it("appendEvent keeps ring buffer capped", async () => {
		const { svc } = await createService()
		for (let i = 0; i < 105; i++) {
			svc.appendEvent({
				type: "view.changed",
				payloadJson: `{"i":${i}}`,
				timestampMs: i,
				source: "user",
			})
		}
		const recent = svc.getRecentEvents(200)
		expect(recent.length).to.be.at.most(100)
		expect(recent[recent.length - 1]?.timestampMs).to.equal(104)
		await svc.flushPersistence()
	})

	it("saveRoiToWorkspace writes roi files and active pointer", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "map-session-"))
		tmpRoots.push(root)
		const { svc } = await createService(root)
		svc.setActiveRoi(
			MapRoi.create({
				id: "penobscot",
				name: "Penobscot",
				source: "map_draw",
				geojson: '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}',
				areaHa: 12400,
				workspacePath: "",
			}),
		)
		const result = await svc.saveRoiToWorkspace("Penobscot basin")
		expect(result.workspacePath).to.equal("roi/penobscot_basin.geojson")
		const pointer = JSON.parse(await fs.readFile(path.join(root, "roi", "active.json"), "utf8"))
		expect(pointer.path).to.equal("roi/penobscot_basin.geojson")
		const geo = await fs.readFile(path.join(root, result.workspacePath), "utf8")
		expect(geo).to.include("Polygon")
		await svc.flushPersistence()
	})

	it("loadRoiFromWorkspace hydrates active ROI from active.json", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "map-session-load-"))
		tmpRoots.push(root)
		await fs.mkdir(path.join(root, "roi"), { recursive: true })
		const rel = "roi/saved_basin.geojson"
		await fs.writeFile(
			path.join(root, rel),
			'{"type":"Feature","geometry":{"type":"Point","coordinates":[0,0]},"properties":{}}',
		)
		await fs.writeFile(path.join(root, "roi", "active.json"), JSON.stringify({ path: rel, name: "Saved basin" }))
		const { svc } = await createService(root)
		const loaded = await svc.loadRoiFromWorkspace()
		expect(loaded.workspacePath).to.equal(rel)
		expect(svc.getActiveRoi()?.source).to.equal("workspace")
		await svc.flushPersistence()
	})

	it("clears workspace-bound state before notifying and persisting a workspace change", async () => {
		const rootA = await fs.mkdtemp(path.join(os.tmpdir(), "map-workspace-a-"))
		const rootB = await fs.mkdtemp(path.join(os.tmpdir(), "map-workspace-b-"))
		tmpRoots.push(rootA, rootB)
		const { svc, stateRoot } = await createService(rootA)
		svc.setBasemap("usgs-topo", "USGS Topo")
		svc.setView(MapSessionView.create({ latitude: 40, longitude: -86, zoom: 7 }))
		svc.setVisibleLayerIds(["workspace-a-layer"])
		svc.setActiveRoi(MapRoi.create({ id: "a", name: "A", source: "user", geojson: '{"type":"Point","coordinates":[0,0]}' }))
		await svc.flushPersistence()
		const delivered: ReturnType<MapSessionService["buildSnapshot"]>[] = []
		svc.subscribeToSession((state) => delivered.push(state))

		svc.setWorkspaceRoot(rootB)

		const switched = delivered.at(-1)
		expect(switched?.workspaceRoot).to.equal(path.resolve(rootB))
		expect(switched?.activeRoi).to.be.undefined
		expect(switched?.visibleLayerIds).to.deep.equal([])
		expect(switched?.basemapId).to.equal("usgs-topo")
		expect(switched?.view?.zoom).to.equal(7)
		await svc.flushPersistence()
		const persisted = JSON.parse(await fs.readFile(path.join(stateRoot, "map_session.json"), "utf8"))
		expect(persisted.workspaceRoot).to.equal(path.resolve(rootB))
		expect(persisted.activeRoi).to.be.undefined
		expect(persisted.visibleLayerIds).to.deep.equal([])
	})

	it("retains workspace-bound state for the same normalized root", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "map-workspace-same-"))
		tmpRoots.push(root)
		const { svc } = await createService(root)
		svc.setVisibleLayerIds(["retained"])
		svc.setActiveRoi(
			MapRoi.create({ id: "same", name: "Same", source: "user", geojson: '{"type":"Point","coordinates":[0,0]}' }),
		)

		svc.setWorkspaceRoot(path.join(root, "child", ".."))

		const snapshot = svc.buildSnapshot([])
		expect(snapshot.activeRoi?.id).to.equal("same")
		expect(snapshot.visibleLayerIds).to.deep.equal(["retained"])
		await svc.flushPersistence()
	})

	it("queues immutable atomic snapshots so the latest accepted state wins", async () => {
		const sessionFile = "/virtual/map_session.json"
		const files = new Map<string, string>()
		let releaseFirstWrite!: () => void
		const firstWriteGate = new Promise<void>((resolve) => {
			releaseFirstWrite = resolve
		})
		let sessionWrites = 0
		const io: MapSessionPersistenceIo = {
			mkdir: async () => undefined,
			readFile: async () => {
				const error = new Error("missing") as NodeJS.ErrnoException
				error.code = "ENOENT"
				throw error
			},
			writeFile: async (file, data) => {
				if (file.startsWith(`${sessionFile}.`)) {
					sessionWrites += 1
					if (sessionWrites === 1) await firstWriteGate
				}
				files.set(file, data)
			},
			rename: async (from, to) => {
				files.set(to, files.get(from) ?? "")
				files.delete(from)
			},
			rm: async (file) => files.delete(file),
		}
		const svc = new MapSessionService({
			sessionFile,
			outboundEventsDir: "/virtual/events",
			persistenceIo: io,
		})
		await svc.initialize()
		svc.setActiveRoi(
			MapRoi.create({ id: "first", name: "First", source: "user", geojson: '{"type":"Point","coordinates":[0,0]}' }),
		)
		svc.setActiveRoi(
			MapRoi.create({ id: "second", name: "Second", source: "user", geojson: '{"type":"Point","coordinates":[1,1]}' }),
		)
		await Promise.resolve()
		await Promise.resolve()
		expect(sessionWrites).to.equal(1)

		releaseFirstWrite()
		await svc.flushPersistence()

		expect(sessionWrites).to.equal(2)
		expect(JSON.parse(files.get(sessionFile) ?? "{}").activeRoi.id).to.equal("second")
	})

	it("does not let delayed initialization overwrite an accepted mutation", async () => {
		const sessionFile = "/virtual/late-load.json"
		const files = new Map<string, string>()
		let releaseRead!: () => void
		const readGate = new Promise<void>((resolve) => {
			releaseRead = resolve
		})
		const io: MapSessionPersistenceIo = {
			mkdir: async () => undefined,
			readFile: async () => {
				await readGate
				return JSON.stringify({
					activeRoi: { id: "disk", name: "Disk", geojson: '{"type":"Point","coordinates":[9,9]}' },
				})
			},
			writeFile: async (file, data) => {
				files.set(file, data)
			},
			rename: async (from, to) => {
				files.set(to, files.get(from) ?? "")
				files.delete(from)
			},
			rm: async (file) => files.delete(file),
		}
		const svc = new MapSessionService({ sessionFile, outboundEventsDir: "/virtual/events", persistenceIo: io })
		const initializing = svc.initialize()
		svc.setActiveRoi(
			MapRoi.create({ id: "accepted", name: "Accepted", source: "user", geojson: '{"type":"Point","coordinates":[0,0]}' }),
		)
		releaseRead()

		await initializing
		await svc.flushPersistence()

		expect(svc.getActiveRoi()?.id).to.equal("accepted")
		expect(JSON.parse(files.get(sessionFile) ?? "{}").activeRoi.id).to.equal("accepted")
	})

	it("rejects corrupt persisted state instead of treating it as first run", async () => {
		const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "map-session-corrupt-"))
		tmpRoots.push(stateRoot)
		const sessionFile = path.join(stateRoot, "map_session.json")
		await fs.writeFile(sessionFile, "not json", "utf8")
		const svc = new MapSessionService({
			sessionFile,
			outboundEventsDir: path.join(stateRoot, "events"),
		})

		let failure: unknown
		try {
			await svc.initialize()
		} catch (error) {
			failure = error
		}
		expect(String(failure)).to.include("Could not initialize map session")
	})

	it("cleans atomic temp files and exposes a failed durable flush", async () => {
		const removed: string[] = []
		const io: MapSessionPersistenceIo = {
			mkdir: async () => undefined,
			readFile: async () => {
				const error = new Error("missing") as NodeJS.ErrnoException
				error.code = "ENOENT"
				throw error
			},
			writeFile: async () => undefined,
			rename: async () => {
				throw new Error("rename failed")
			},
			rm: async (file) => {
				removed.push(file)
			},
		}
		const svc = new MapSessionService({
			sessionFile: "/virtual/failing.json",
			outboundEventsDir: "/virtual/events",
			persistenceIo: io,
		})
		await svc.initialize()
		svc.setView(MapSessionView.create({ zoom: 4 }))

		let failure: unknown
		try {
			await svc.flushPersistence()
		} catch (error) {
			failure = error
		}
		expect(String(failure)).to.include("rename failed")
		expect(removed).to.have.length(1)
		expect(removed[0]).to.match(/failing\.json\..*\.tmp$/)
	})
})
