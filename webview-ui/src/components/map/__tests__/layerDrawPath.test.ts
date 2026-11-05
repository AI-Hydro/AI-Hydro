import type { MapLayer } from "@shared/proto/cline/map"
import { describe, expect, it } from "vitest"
import { drawSources } from "../layerDrawPath"

const layer = (metadata: Record<string, string>) =>
	({ id: "x", name: "x", layerType: "polygon", geojson: "", metadata }) as unknown as MapLayer

describe("where a layer with no geometry in hand is drawn from", () => {
	it("a layer that names a file is drawn from that file before its cache copy", () => {
		const sources = drawSources(
			layer({
				source: "workspace",
				path: "a.geojson",
				workspace_folder: "/proj",
				geojson_cache_path: "/home/.aihydro/c/a.geojson",
			}),
		)
		expect(sources).toEqual([
			{ path: "a.geojson", kind: "project", workspaceFolder: "/proj" },
			{ path: "/home/.aihydro/c/a.geojson", kind: "cache" },
		])
	})

	it("a tool's layer is drawn from its cache copy before any file", () => {
		const sources = drawSources(
			layer({
				tool: "extract_rivers",
				_run_id: "run-1.1",
				geojson_cache_path: "/c/t.geojson",
				source_path: "/w/t.geojson",
			}),
		)
		expect(sources.map((s) => s.kind)).toEqual(["cache", "project"])
	})

	it("a simplified preview, when there is one, comes first and is a cache file", () => {
		const sources = drawSources(layer({ display_geojson_path: "/c/preview.json", source_path: "/w/a.geojson" }))
		expect(sources[0]).toEqual({ path: "/c/preview.json", kind: "cache" })
		expect(sources[1].kind).toBe("project")
	})

	it("a layer that names nothing has nothing to draw from", () => {
		expect(drawSources(layer({}))).toEqual([])
	})
})
