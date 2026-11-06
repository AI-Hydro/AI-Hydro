import { describe, expect, it, vi } from "vitest"
import { LayerLoadError } from "../formats/types"
import { answerRefreshRequest, isRefreshFileRequest, type RefreshFileResult, type RefreshIo } from "../refreshFile"

const enc = (t: string) => new TextEncoder().encode(t)
const H = "sha-of-12345"
const request = {
	requestId: "r1",
	layerId: "user-a",
	uri: "vscode-resource://a",
	path: "/w/a.geojson",
	name: "a.geojson",
	sizeBytes: 5,
	sha256: H,
	mtimeMs: 10,
}
const io = (over: Partial<RefreshIo> = {}) => {
	const posted: RefreshFileResult[] = []
	const full: RefreshIo = {
		fetchBytes: async () => enc("12345"),
		sha256: async (b) => (new TextDecoder().decode(b) === "12345" ? H : "other"),
		load: (async () => ({
			kind: "vector",
			id: "x",
			name: "a",
			geojson: '{"type":"FeatureCollection","features":[]}',
			metadata: { source_format: "geojson" },
		})) as any,
		post: (m) => posted.push(m),
		...over,
	}
	return { full, posted }
}

describe("the page's half of a file refresh", () => {
	it("recognises a request by its fields, not by its type alone", () => {
		expect(isRefreshFileRequest(request)).toBe(true)
		expect(isRefreshFileRequest({ ...request, sizeBytes: "5" })).toBe(false)
		expect(isRefreshFileRequest(null)).toBe(false)
	})

	it("parses the bytes the host hashed and sends them back with the request's ids", async () => {
		const { full, posted } = io()
		await answerRefreshRequest(request, full)
		expect(posted).toHaveLength(1)
		expect(posted[0]).toMatchObject({ type: "aihydro-map-refresh-result", requestId: "r1", layerId: "user-a", ok: true })
		expect(posted[0].geojson).toContain("FeatureCollection")
		expect(posted[0].metadata).toEqual({ source_format: "geojson" })
	})

	it("a different number of bytes than the host saw is a file that changed while it was read, and nothing is parsed", async () => {
		const load = vi.fn()
		const { full, posted } = io({ fetchBytes: async () => enc("123456789"), load: load as any })
		await answerRefreshRequest(request, full)
		expect(posted[0]).toMatchObject({ ok: false, reason: "changed_while_reading" })
		expect(load).not.toHaveBeenCalled()
	})

	it("a rewrite of the same length is a different file: the hash decides, nothing is parsed", async () => {
		const load = vi.fn()
		const { full, posted } = io({ fetchBytes: async () => enc("54321"), load: load as any })
		await answerRefreshRequest(request, full)
		expect(posted[0]).toMatchObject({ ok: false, reason: "changed_while_reading" })
		expect(load).not.toHaveBeenCalled()
	})

	it("where the page has no crypto, the size check alone applies", async () => {
		const { full, posted } = io({ sha256: async () => undefined })
		await answerRefreshRequest(request, full)
		expect(posted[0]).toMatchObject({ ok: true })
	})

	it("a file that cannot be fetched is the same: it moved between the host's read and this one", async () => {
		const { full, posted } = io({ fetchBytes: async () => Promise.reject(new Error("HTTP 404")) })
		await answerRefreshRequest(request, full)
		expect(posted[0]).toMatchObject({ ok: false, reason: "changed_while_reading" })
	})

	it("a parse error goes back with its message", async () => {
		const { full, posted } = io({
			load: (async () => Promise.reject(new LayerLoadError("Invalid GeoJSON: Unexpected end of JSON input"))) as any,
		})
		await answerRefreshRequest(request, full)
		expect(posted[0]).toMatchObject({ ok: false, reason: "parse", message: "Invalid GeoJSON: Unexpected end of JSON input" })
	})

	it("a raster is not parsed in place", async () => {
		const { full, posted } = io({ load: (async () => ({ kind: "raster", id: "x", name: "a" })) as any })
		await answerRefreshRequest(request, full)
		expect(posted[0]).toMatchObject({ ok: false, reason: "unsupported" })
	})
})
