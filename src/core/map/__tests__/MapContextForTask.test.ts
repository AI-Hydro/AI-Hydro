import { expect } from "chai"
import { describe, it } from "mocha"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { TaskState } from "../../task/TaskState"
import {
	buildMapContextForTask,
	capWithMarker,
	decideMapContextInjection,
	isMapLaunched,
	mapContextForEnvironmentDetails,
	workspaceMatches,
	MAP_CONTEXT_MAX_CHARS,
	MAP_CONTEXT_TRUNCATION_MARKER,
	userMessageReferencesMap,
} from "../MapContextForTask"

const ev = (type: string, payload: Record<string, unknown> = {}, source = "user") => ({
	type,
	source,
	payloadJson: JSON.stringify(payload),
})

interface FakeOpts {
	root?: string
	basemap?: boolean
	layers?: number
	events?: ReturnType<typeof ev>[]
	inspect?: boolean
}

/** Shape of the session study: an India map with many layers, a basemap, a view and mostly camera events. */
function fakeController(o: FakeOpts = {}) {
	const layers = Array.from({ length: o.layers ?? 0 }, (_, i) => ({
		id: `layer_${i}`,
		name: `India catchment ${i}`,
		layerType: "vector",
		visible: true,
		metadata: {},
	}))
	const events = o.events ?? []
	return {
		getMapLayers: () => layers,
		getWorkspaceGeoJsonFiles: () => [],
		mapSessionService: {
			getWorkspaceRoot: () => o.root ?? "",
			getBasemap: () => (o.basemap === false ? undefined : { id: "osm", name: "OpenStreetMap" }),
			getView: () => ({ latitude: 20.5, longitude: 78.9, zoom: 5 }),
			getRecentEvents: (n = 20) => events.slice(-n),
			getLastInspect: () =>
				o.inspect
					? { lat: 21.1, lon: 79.2, layerName: "India catchment 0", featureCount: 1, featureProperties: { area: 12 } }
					: undefined,
		},
	} as any
}

const req = (over: Partial<{ taskCwd: string; launchedFromMap: boolean; userReferencedMap: boolean }> = {}) => ({
	taskCwd: "/work/colorado",
	launchedFromMap: false,
	userReferencedMap: false,
	...over,
})

describe("map context gate (X0-8)", () => {
	it("does not inject an unrelated workspace's map", () => {
		const c = fakeController({ root: "/work/india", layers: 6, events: [ev("layer.geojson", { name: "x" })] })
		expect(buildMapContextForTask(c, req())).to.equal("")
	})

	it("does not inject just because a basemap was once set", () => {
		const c = fakeController({ root: "/work/colorado", layers: 0, events: [ev("view.changed")] })
		expect(buildMapContextForTask(c, req())).to.equal("")
	})

	it("injects a map that belongs to the task's workspace, including a project folder inside it", () => {
		const c = fakeController({ root: "/work/colorado", layers: 2 })
		expect(buildMapContextForTask(c, req())).to.contain("Layers: 2")
		expect(
			buildMapContextForTask(
				fakeController({ root: "/data/hydro/colorado", layers: 2 }),
				req({ taskCwd: "/data/hydro/colorado/study_a" }),
			),
		).to.contain("Layers: 2")
	})

	it("a map-launched chat or an explicit map mention gets context even when the folders differ", () => {
		const c = fakeController({ root: "/work/india", layers: 2 })
		expect(buildMapContextForTask(c, req({ launchedFromMap: true }))).to.contain("Layers: 2")
		expect(buildMapContextForTask(c, req({ userReferencedMap: true }))).to.contain("Layers: 2")
	})

	it("with no workspace key, injects only for a map-launched chat or when the user referred to the map", () => {
		const c = fakeController({ root: "", layers: 2 })
		expect(buildMapContextForTask(c, req())).to.equal("")
		expect(buildMapContextForTask(c, req({ launchedFromMap: true }))).to.contain("Layers: 2")
		expect(buildMapContextForTask(c, req({ userReferencedMap: true }))).to.contain("Layers: 2")
	})

	it("drops pan/zoom/move events and keeps meaningful ones", () => {
		const c = fakeController({
			root: "/work/colorado",
			layers: 1,
			events: [
				ev("layer.geojson", { name: "Basin" }),
				ev("view.changed"),
				ev("command.fit_extent"),
				ev("command.fly_to"),
				ev("inspect.click", { featureCount: 2 }),
				ev("view.changed"),
				ev("delineation.completed", { area_km2: 120 }),
			],
		})
		const out = buildMapContextForTask(c, req())
		expect(out).not.to.match(/panned|zoomed|fit extent|view\.changed|zoom/i)
		expect(out).to.contain("layer added Basin")
		expect(out).to.contain("feature selected")
		expect(out).to.contain("delineation done")
	})

	it("holds the 600-character cap with a deterministic marker", () => {
		const c = fakeController({
			root: "/work/colorado",
			layers: 40,
			inspect: true,
			events: [ev("layer.geojson", { name: "n".repeat(300) })],
		})
		const out = buildMapContextForTask(c, req())
		expect(out.length).to.be.at.most(MAP_CONTEXT_MAX_CHARS)
		expect(buildMapContextForTask(c, req())).to.equal(out)
		const long = "x".repeat(2000)
		const capped = capWithMarker(long)
		expect(capped.length).to.equal(MAP_CONTEXT_MAX_CHARS)
		expect(capped.endsWith(MAP_CONTEXT_TRUNCATION_MARKER)).to.equal(true)
		expect(capWithMarker("short")).to.equal("short")
	})

	it("does not re-send an unchanged block, but re-sends when it changed or the user referred to it", () => {
		const a = "\n\n## Map context\nLayers: 2"
		const b = "\n\n## Map context\nLayers: 3"
		let d = decideMapContextInjection(a, undefined, false)
		expect(d.inject).to.equal(true)
		d = decideMapContextInjection(a, d.next, false)
		expect(d.inject).to.equal(false)
		expect(decideMapContextInjection(a, d.next, true).inject).to.equal(true)
		d = decideMapContextInjection(b, d.next, false)
		expect(d.inject).to.equal(true)
		// the gate closing forgets the block, so the same map returning is sent again
		d = decideMapContextInjection("", d.next, false)
		expect(d).to.deep.equal({ inject: false, next: undefined })
		expect(decideMapContextInjection(b, d.next, false).inject).to.equal(true)
	})

	it("a camera-only change leaves the block identical (so it is not re-sent)", () => {
		const base = { root: "/work/colorado", layers: 2, events: [ev("layer.geojson", { name: "Basin" })] }
		const before = buildMapContextForTask(fakeController(base), req())
		const after = buildMapContextForTask(
			fakeController({ ...base, events: [...base.events, ev("view.changed"), ev("view.changed")] }),
			req(),
		)
		expect(after).to.equal(before)
	})

	it("detects a map reference only in user-authored text", () => {
		expect(userMessageReferencesMap([{ type: "text", text: "<task>\nWhat is on the map?\n</task>" }])).to.equal(true)
		expect(userMessageReferencesMap([{ type: "text", text: "<task>\nCompute NSE\n</task>" }])).to.equal(false)
		expect(userMessageReferencesMap([{ type: "text", text: "[read_file] result: the map of keys" }])).to.equal(false)
	})
})

describe("map context size per turn (session-study fixture)", () => {
	it("a 12-turn chat in an unrelated workspace carries no map text", () => {
		const events = [
			...Array.from({ length: 30 }, () => ev("view.changed")),
			ev("layer.geojson", { name: "India basin" }),
			ev("inspect.click", { featureCount: 1 }),
		]
		const c = fakeController({ root: "/work/india", layers: 12, events, inspect: true })
		let last: string | undefined
		let total = 0
		for (let turn = 0; turn < 12; turn++) {
			const block = buildMapContextForTask(c, req())
			const d = decideMapContextInjection(block, last, false)
			last = d.next
			total += d.inject ? block.length : 0
		}
		expect(total).to.equal(0)
	})

	it("a 12-turn chat in the map's own workspace sends the block once, within the cap", () => {
		const events = [...Array.from({ length: 30 }, () => ev("view.changed")), ev("layer.geojson", { name: "India basin" })]
		const c = fakeController({ root: "/work/india", layers: 12, events, inspect: true })
		let last: string | undefined
		let sends = 0
		let total = 0
		for (let turn = 0; turn < 12; turn++) {
			const block = buildMapContextForTask(c, req({ taskCwd: "/work/india" }))
			const d = decideMapContextInjection(block, last, false)
			last = d.next
			if (d.inject) {
				sends++
				total += block.length
			}
		}
		expect(sends).to.equal(1)
		expect(total).to.be.at.most(MAP_CONTEXT_MAX_CHARS)
	})
})

describe("workspaceMatches: broad parents never claim children", () => {
	it("matches equal folders and real containment", () => {
		expect(workspaceMatches("/data/hydro/colorado", "/data/hydro/colorado")).to.equal(true)
		expect(workspaceMatches("/data/hydro/colorado", "/data/hydro/colorado/a")).to.equal(true)
		expect(workspaceMatches("/data/hydro/colorado/a", "/data/hydro/colorado")).to.equal(true)
		expect(workspaceMatches("C:\\Users\\me\\proj", "C:/Users/me/proj/sub")).to.equal(true)
	})

	it("a drive root, the home directory or a folder shallower than depth 3 does not match its children", () => {
		expect(workspaceMatches("/", "/work/colorado")).to.equal(false)
		expect(workspaceMatches("C:\\", "C:\\work\\colorado\\x")).to.equal(false)
		expect(workspaceMatches("/Users/me", "/Users/me/proj/a")).to.equal(false)
		expect(workspaceMatches("/work/colorado", "/work/colorado/a")).to.equal(false)
		const home = os.homedir().replace(/\\/g, "/")
		expect(workspaceMatches(home, `${home}/a/b/c`)).to.equal(false)
		expect(workspaceMatches("/work/colorado/a", "/work/colorado")).to.equal(false)
	})

	it("a different folder never matches", () => {
		expect(workspaceMatches("/data/hydro/india", "/data/hydro/colorado")).to.equal(false)
		expect(workspaceMatches("", "/data/hydro/colorado")).to.equal(false)
	})
})

describe("capWithMarker truncation safety", () => {
	it("never leaves a lone high surrogate in front of the marker", () => {
		const keep = MAP_CONTEXT_MAX_CHARS - MAP_CONTEXT_TRUNCATION_MARKER.length
		const text = `${"a".repeat(keep - 1)}\u{1F30A}${"b".repeat(100)}` // the pair straddles the cut
		const out = capWithMarker(text)
		expect(out.length).to.be.at.most(MAP_CONTEXT_MAX_CHARS)
		expect(out.endsWith(MAP_CONTEXT_TRUNCATION_MARKER)).to.equal(true)
		const before = out.slice(0, out.length - MAP_CONTEXT_TRUNCATION_MARKER.length)
		const last = before.charCodeAt(before.length - 1)
		expect(last >= 0xd800 && last <= 0xdbff).to.equal(false)
	})
})

describe("map context wiring into environment_details", () => {
	const ctl = () =>
		fakeController({ root: "/data/hydro/colorado", layers: 2, events: [ev("layer.geojson", { name: "Basin" })] })
	const cwd = "/data/hydro/colorado"
	const text = (t: string) => [{ type: "text", text: t }]

	it("threads the user's content: a map mention re-sends an unchanged block", () => {
		const state = new TaskState()
		const c = ctl()
		expect(mapContextForEnvironmentDetails(c, state, cwd, false, text("<task>\nrun NSE\n</task>"))).to.contain("Map context")
		expect(mapContextForEnvironmentDetails(c, state, cwd, false, text("<feedback>\nok\n</feedback>"))).to.equal("")
		expect(
			mapContextForEnvironmentDetails(c, state, cwd, false, text("<feedback>\nwhat is on the map?\n</feedback>")),
		).to.contain("Map context")
	})

	it("launchedFromMap comes from the launch and from the history item", () => {
		expect(isMapLaunched({ origin: "map" }, undefined)).to.equal(true)
		expect(isMapLaunched(undefined, { origin: "map" })).to.equal(true)
		expect(isMapLaunched({ origin: "chat" }, { origin: "map" })).to.equal(false)
		expect(isMapLaunched(undefined, { origin: "chat" })).to.equal(false)
		expect(isMapLaunched(undefined, undefined)).to.equal(false)
		const state = new TaskState()
		const noKey = fakeController({ root: "", layers: 2 })
		expect(mapContextForEnvironmentDetails(noKey, state, cwd, isMapLaunched(undefined, { origin: "map" }), [])).to.contain(
			"Map context",
		)
		expect(
			mapContextForEnvironmentDetails(noKey, new TaskState(), cwd, isMapLaunched(undefined, { origin: "chat" }), []),
		).to.equal("")
	})

	it("truncation (setConversationHistoryDeletedRange) makes an unchanged map be re-sent", () => {
		const state = new TaskState()
		const c = ctl()
		expect(mapContextForEnvironmentDetails(c, state, cwd, false, [])).to.contain("Map context")
		expect(mapContextForEnvironmentDetails(c, state, cwd, false, [])).to.equal("")
		state.setConversationHistoryDeletedRange([1, 4])
		expect(state.conversationHistoryDeletedRange).to.deep.equal([1, 4])
		expect(mapContextForEnvironmentDetails(c, state, cwd, false, [])).to.contain("Map context")
	})

	it("every deleted-range change in the Task goes through the resetting setter, and loadContext uses the shared helper", () => {
		const src = fs.readFileSync(path.join(__dirname, "../../task/index.ts"), "utf8")
		expect(src).not.to.match(/taskState\.conversationHistoryDeletedRange\s*=[^=]/)
		expect(src).to.contain(
			"mapContextForEnvironmentDetails(this.controller, this.taskState, this.cwd, this.launchedFromMap, userContent)",
		)
		expect(src).to.contain("this.getEnvironmentDetails(includeFileDetails, userContent)")
		expect(src).to.contain("this.taskState.lastInjectedMapContext = undefined") // compaction path
	})
})
