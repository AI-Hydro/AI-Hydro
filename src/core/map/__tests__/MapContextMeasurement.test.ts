import { expect } from "chai"
import { describe, it } from "mocha"
import { buildMapContextForTask, decideMapContextInjection, MAP_CONTEXT_MAX_CHARS } from "../MapContextForTask"
import { buildMapContextForTask as legacyBuild } from "./fixtures/legacyMapContext"

/**
 * Reproducible size measurement for X0-8. The fixture has the shape of the session study: a stale India map with 12
 * layers, 10 workspace files, a basemap, a view and 35 events that are almost all `view.changed`. The legacy builder
 * is a frozen copy of the pre-X0-8 code, so the "before" number can be re-derived at any time.
 */
const ev = (type: string, payload: Record<string, unknown> = {}) => ({
	type,
	source: "user",
	payloadJson: JSON.stringify(payload),
})

function controller(root: string) {
	const layers = Array.from({ length: 12 }, (_, i) => ({
		id: `layer_${i}`,
		name: `India catchment ${i}`,
		layerType: "vector",
		visible: true,
		metadata: { path: `data/india/catch_${i}.geojson` },
		style: { fillColor: "#3388ff" },
	}))
	const events = [
		...Array.from({ length: 30 }, () => ev("view.changed")),
		ev("layer.geojson", { name: "India basin" }),
		ev("inspect.click", { featureCount: 1 }),
		...Array.from({ length: 5 }, () => ev("view.changed")),
	]
	return {
		getMapLayers: () => layers,
		getWorkspaceGeoJsonFiles: () => Array.from({ length: 10 }, (_, i) => ({ relativePath: `data/india/catch_${i}.geojson` })),
		mapSessionService: {
			getWorkspaceRoot: () => root,
			getBasemap: () => ({ id: "osm", name: "OpenStreetMap" }),
			getView: () => ({ latitude: 20.5, longitude: 78.9, zoom: 5 }),
			getRecentEvents: (n = 20) => events.slice(-n),
			getLastInspect: () => ({
				lat: 21.1,
				lon: 79.2,
				layerName: "India catchment 0",
				featureCount: 1,
				featureProperties: { area: 12, name: "x" },
			}),
		},
	} as any
}

function charsOver12Turns(c: any, taskCwd: string, launchedFromMap: boolean) {
	let last: string | undefined
	const perTurn: number[] = []
	for (let turn = 0; turn < 12; turn++) {
		const block = buildMapContextForTask(c, { taskCwd, launchedFromMap, userReferencedMap: false })
		const d = decideMapContextInjection(block, last, false)
		last = d.next
		perTurn.push(d.inject ? block.length : 0)
	}
	return perTurn
}

describe("X0-8 map context size per turn (locked measurement)", () => {
	const c = controller("/data/hydro/india")

	it("before: the legacy builder sends the same 1949 characters every turn", () => {
		expect(legacyBuild(c).length).to.equal(1949)
		expect(legacyBuild(c).length * 12).to.equal(23388)
	})

	it("after, unrelated workspace: nothing is sent", () => {
		expect(charsOver12Turns(c, "/data/hydro/colorado", false)).to.deep.equal(Array(12).fill(0))
	})

	it("after, same workspace: one send of 483 characters, then nothing", () => {
		const turns = charsOver12Turns(c, "/data/hydro/india", false)
		expect(turns[0]).to.equal(483)
		expect(turns.slice(1)).to.deep.equal(Array(11).fill(0))
		expect(turns[0]).to.be.at.most(MAP_CONTEXT_MAX_CHARS)
	})

	it("after, map-launched chat with no workspace key: one send of 483 characters, then nothing", () => {
		const turns = charsOver12Turns(controller(""), "/data/hydro/colorado", true)
		expect(turns[0]).to.equal(483)
		expect(turns.slice(1)).to.deep.equal(Array(11).fill(0))
	})
})
