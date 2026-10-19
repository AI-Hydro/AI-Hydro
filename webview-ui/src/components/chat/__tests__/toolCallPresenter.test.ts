import {
	describeAreaRatio,
	describeProvisional,
	describeSiteResolution,
	assertedGauge,
	describeQualityExtras,
	getPairing,
	pairScienceCalls,
	firstSentence,
	isScienceServer,
	presentToolCall,
} from "@shared/aihydro/toolCallPresenter"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
	areaFailCall,
	argRepairRefusal,
	outletSnapResolution,
	provisionalCall,
	refusalCall,
	signaturesCall,
	successCall,
} from "../../../screens/fixtures/aihydro"

const present = (c: typeof successCall) =>
	presentToolCall("ai-hydro", c.toolName, c.argsJson, c.resultText, c.annotations, c.meta)

describe("presenter: recorded success (explicit gauge id, area check pass)", () => {
	const m = present(successCall)

	it("reads every field from the server's own keys", () => {
		expect(m.resultState).toBe("ok")
		expect(m.purpose).toBe("Fetch a single hydrology variable for one geometry / time window.")
		expect(m.runId).toBe("dfetch.20261017.e2eproo.48d4b668")
		expect(m.place).toEqual({ kind: "site_resolution", label: "USGS-01013500", detail: "Fish River near Fort Kent, Maine" })
		expect(m.dataSource).toEqual({
			backend: "usgs_waterdata",
			product: "NWIS_STREAMFLOW",
			source: "direct_api",
			retrievedAt: "2026-10-17T17:19:59Z",
		})
		expect(m.siteResolution).toMatchObject({ method: "explicit_id", areaCheck: "pass", distanceM: undefined, warnings: [] })
		expect(m.siteResolution?.logAreaRatio).toBeCloseTo(0.00037891780674427814, 12)
		expect(m.quality?.provisional).toEqual({ count: 0, total: 7305, first: undefined, last: undefined })
		expect(m.refusal).toBeUndefined()
	})

	it("reports no information class: the server sends none and the product name is not used to guess one", () => {
		expect(m.dataSource?.product).toBe("NWIS_STREAMFLOW")
		expect(m.informationClass).toBeUndefined()
	})

	it("types the arguments from the input schema and summarises long values", () => {
		const by = Object.fromEntries(m.typedArgs.map((a) => [a.name, a]))
		expect(by.variable).toMatchObject({ value: "streamflow", type: "string", required: true, inSchema: true })
		expect(by.gauge_id).toMatchObject({ value: "01013500", type: "string", required: false })
		expect(by.session_id.value).toBe("e2e-proof-3-01013500-20261017T171951Z")
		expect(by.units).toBeUndefined()
		expect(m.typedArgs.every((a) => a.units === undefined)).toBe(true)
	})

	it("turns the readOnlyHint annotation into a hedged hint", () => {
		expect(m.effectHint).toBe("May write session data (server hint)")
		expect(presentToolCall("ai-hydro", "t", "{}", undefined, { readOnlyHint: true }).effectHint).toBe(
			"Read-only (server hint)",
		)
		expect(presentToolCall("ai-hydro", "t", "{}", undefined, {}).effectHint).toBeUndefined()
		expect(presentToolCall("ai-hydro", "t", "{}", undefined).effectHint).toBeUndefined()
	})

	it("keeps the raw arguments and result for the disclosure", () => {
		expect(m.rawArgs).toBe(successCall.argsJson)
		expect(m.rawResult).toBe(successCall.resultText)
	})
})

describe("presenter: provisional quality", () => {
	const m = present(provisionalCall)
	it("reports n/N with the dates the server gave", () => {
		expect(m.quality?.provisional).toEqual({
			count: 43,
			total: 120,
			first: "2026-09-04T00:00:00",
			last: "2026-10-16T00:00:00",
		})
		expect(m.quality?.approvalCounts).toEqual({ Approved: 77, Provisional: 43 })
		expect(describeProvisional(m.quality!.provisional!)).toBe("provisional 43/120 (2026-09-04 to 2026-10-16)")
	})
	it("omits the date range when nothing is provisional", () => {
		expect(describeProvisional({ count: 0, total: 7305 })).toBe("provisional 0/7305")
	})
	it("reports no quality when the summary lacks counts", () => {
		const r = presentToolCall("ai-hydro", "t", "{}", JSON.stringify({ quality: { backend: "x" } }))
		expect(r.quality).toBeUndefined()
	})
})

describe("presenter: gauge resolution", () => {
	it("flags a failed area check and keeps the log-area ratio for the hover text", () => {
		const m = present(areaFailCall)
		expect(m.siteResolution).toMatchObject({ site: "USGS-01109000", method: "explicit_id", areaCheck: "fail" })
		expect(m.siteResolution?.logAreaRatio).toBeCloseTo(-2.999961658833441, 9)
		expect(m.siteResolution?.warnings[0]).toContain("area_check=fail")
		expect(describeSiteResolution(m.siteResolution!)).toBe("explicit_id · distance not reported · area check fail")
		expect(describeAreaRatio(m.siteResolution!)).toBe("log area ratio -3.000; gauge/basin area ratio 0.0498; limit ±0.095")
	})

	it("reads an outlet_snap record: signed distance in metres", () => {
		const m = presentToolCall("ai-hydro", "t", "{}", JSON.stringify({ site_resolution: outletSnapResolution }))
		expect(m.siteResolution).toMatchObject({ method: "outlet_snap", distanceM: 0, areaCheck: "pass" })
		expect(describeSiteResolution(m.siteResolution!)).toBe("outlet_snap · 0.0 m · area check pass")
	})

	it("says 'not reported' for an unrecognised or missing area check", () => {
		const m = presentToolCall(
			"ai-hydro",
			"t",
			"{}",
			JSON.stringify({ site_resolution: { site: "S", method: "m", area_check: "maybe" } }),
		)
		expect(m.siteResolution?.areaCheck).toBeUndefined()
		expect(describeSiteResolution(m.siteResolution!)).toBe("m · distance not reported · area check not reported")
	})

	it("reports no resolution for an empty object", () => {
		expect(presentToolCall("ai-hydro", "t", "{}", JSON.stringify({ site_resolution: {} })).siteResolution).toBeUndefined()
	})
})

describe("presenter: refusals", () => {
	it("reads the terminal envelope; the host's Error: prefix is accepted", () => {
		expect(refusalCall.resultText.startsWith("Error:\n")).toBe(true)
		const m = present(refusalCall)
		expect(m.resultState).toBe("error")
		expect(m.refusal?.code).toBe("GAUGE_REQUIRED")
		expect(m.refusal?.message).toBe("no gauge id, usgs alias or outlet was supplied")
		expect(m.refusal?.recovery).toHaveLength(1)
		expect(m.refusal?.recovery[0]).toContain("pass gauge_id=")
		expect(m.refusal?.nextTools).toEqual([])
		expect(m.refusal?.exampleCall).toBeUndefined()
		expect(m.runId).toBeUndefined()
	})

	it("also recognises the envelope without the prefix", () => {
		const m = presentToolCall("ai-hydro", "t", "{}", refusalCall.resultText.replace(/^Error:\n/, ""))
		expect(m.refusal?.code).toBe("GAUGE_REQUIRED")
	})

	it("shows the example call as text and reports a missing code as not reported", () => {
		const m = present(argRepairRefusal)
		expect(m.refusal?.code).toBeUndefined()
		expect(JSON.parse(m.refusal!.exampleCall!)).toEqual({
			tool: "compute_spectral_index",
			arguments: { index_name: "<index_name>" },
		})
		expect(m.refusal?.message).toContain("could not be completed")
	})

	it("lists candidate sites from details.candidates", () => {
		const text = JSON.stringify({
			error: true,
			code: "GAUGE_AMBIGUOUS",
			message: "m",
			recovery: ["a", "b"],
			details: { candidates: [{ site: "USGS-1" }, "USGS-2"] },
		})
		const r = presentToolCall("ai-hydro", "t", "{}", text).refusal
		expect(r?.candidates).toEqual(["USGS-1", "USGS-2"])
		expect(r?.recovery).toEqual(["a", "b"])
	})

	it("treats a host-marked error without an envelope as a refusal with no code", () => {
		const m = presentToolCall("ai-hydro", "t", "{}", "Error:\nsomething plain failed")
		expect(m.refusal?.code).toBeUndefined()
		expect(m.refusal?.message).toBe("something plain failed")
		expect(m.resultState).toBe("error")
	})

	it("does not treat error:false or ok:true as a refusal", () => {
		expect(presentToolCall("ai-hydro", "t", "{}", JSON.stringify({ error: false, ok: 1 })).refusal).toBeUndefined()
		expect(presentToolCall("ai-hydro", "t", "{}", JSON.stringify({ ok: true })).refusal).toBeUndefined()
		expect(presentToolCall("ai-hydro", "t", "{}", JSON.stringify({ error: "" })).refusal).toBeUndefined()
	})

	it("treats a non-empty string error as a refusal with the string as its message", () => {
		const m = presentToolCall("ai-hydro", "t", "{}", JSON.stringify({ error: "session not found" }))
		expect(m.resultState).toBe("error")
		expect(m.refusal?.code).toBeUndefined()
		expect(m.refusal?.message).toBe("session not found")
	})

	it("treats ok:false as a refusal and prefers an explicit message", () => {
		const m = presentToolCall("ai-hydro", "t", "{}", JSON.stringify({ ok: false, message: "nothing to do", code: "NOPE" }))
		expect(m.resultState).toBe("error")
		expect(m.refusal).toMatchObject({ code: "NOPE", message: "nothing to do" })
		expect(presentToolCall("ai-hydro", "t", "{}", JSON.stringify({ ok: false })).refusal?.message).toBeUndefined()
	})
})

describe("presenter: unreported fields", () => {
	const m = present(signaturesCall)
	it("leaves absent fields undefined, never inferred", () => {
		expect(m.resultState).toBe("ok")
		expect(m.runId).toBe("sigs.20261017.e2eproo.637c355a")
		expect(m.place).toEqual({ kind: "gauge_id", label: "01013500" })
		expect(m.dataSource).toBeUndefined()
		expect(m.siteResolution).toBeUndefined()
		expect(m.quality).toBeUndefined()
		expect(m.informationClass).toBeUndefined()
	})
	it("elided long arguments are summarised", () => {
		expect(m.typedArgs.find((a) => a.name === "geometry_geojson")?.value).toContain("<elided")
	})
})

describe("presenter: information class (explicit field only)", () => {
	// Inline one-key objects: no server emits this field yet, so there is no recorded body.
	const cls = (v: unknown) => presentToolCall("ai-hydro", "t", "{}", JSON.stringify({ information_class: v })).informationClass
	it("passes a recognised class through unchanged", () => {
		for (const v of ["observed", "modelled", "reanalysis", "derived", "projection"]) {
			expect(cls(v)).toEqual({ value: v, recognised: true })
		}
	})
	it("keeps an unrecognised value visible but flagged", () => {
		expect(cls("measured")).toEqual({ value: "measured", recognised: false })
	})
	it("ignores empty and non-string values", () => {
		expect(cls("")).toBeUndefined()
		expect(cls(3)).toBeUndefined()
		expect(cls(null)).toBeUndefined()
	})
	it("does not look inside nested objects or other keys", () => {
		const m = presentToolCall(
			"ai-hydro",
			"t",
			"{}",
			JSON.stringify({ data: { information_class: "observed" }, product: "observed" }),
		)
		expect(m.informationClass).toBeUndefined()
	})
})

describe("presenter: place", () => {
	it("prefers a basin_ref (alias CURIE, then the rest, then area)", () => {
		// Built from the BasinRef schema in aihydro-core records/place.py; area is an illustrative number.
		const ref = {
			id: "aihydro:basin:sha256:abc",
			aliases: [
				{ scheme: "usgs", id: "01013500" },
				{ scheme: "comid", id: "724696" },
			],
			area_km2: 1,
		}
		const m = presentToolCall("ai-hydro", "t", "{}", JSON.stringify({ basin_ref: ref, gauge_id: "other" }))
		expect(m.place).toEqual({ kind: "basin_ref", label: "usgs:01013500", detail: "comid:724696 · 1 km²" })
	})
	it("falls back to the basin id when there are no aliases", () => {
		const m = presentToolCall(
			"ai-hydro",
			"t",
			"{}",
			JSON.stringify({ data: { basin_ref: { id: "aihydro:basin:sha256:abc" } } }),
		)
		expect(m.place).toEqual({ kind: "basin_ref", label: "aihydro:basin:sha256:abc", detail: undefined })
	})
})

describe("presenter: robustness", () => {
	it("is pending while there is no result", () => {
		const m = presentToolCall("ai-hydro", "t", '{"a":1}', undefined)
		expect(m.resultState).toBe("pending")
		expect(m.typedArgs).toEqual([
			{ name: "a", value: "1", type: undefined, units: undefined, required: false, inSchema: false },
		])
	})
	it("keeps the text of a non-JSON result and reads no fields", () => {
		const m = presentToolCall("ai-hydro", "t", "{}", "plain text, not JSON")
		expect(m.resultState).toBe("unparsed")
		expect(m.rawResult).toBe("plain text, not JSON")
		expect(m.runId).toBeUndefined()
	})
	it("does not throw on malformed arguments", () => {
		const m = presentToolCall("ai-hydro", "t", "{not json", "{}")
		expect(m.typedArgs).toEqual([])
		expect(m.rawArgs).toBe("{not json")
	})
	it("reads the structured first content item when more follow", () => {
		const m = presentToolCall("ai-hydro", "t", "{}", `${JSON.stringify({ _run_id: "r1" })}\n\nsecond item`)
		expect(m.runId).toBe("r1")
	})
	it("splits trailing image data URLs off the result text", () => {
		const url = "data:image/png;base64,AAAA"
		const m = presentToolCall("ai-hydro", "t", "{}", `${JSON.stringify({ _run_id: "r1" })}\n\n${url}`)
		expect(m.images).toEqual([url])
		expect(m.runId).toBe("r1")
		expect(m.rawResult).not.toContain("base64")
	})
	it("takes images only from the trailing host-appended run", () => {
		const url = "data:image/png;base64,AAAA"
		const inside = presentToolCall("ai-hydro", "t", "{}", JSON.stringify({ note: `\n\n${url}\n\nmore`, _run_id: "r1" }))
		expect(inside.images).toEqual([])
		const mid = presentToolCall("ai-hydro", "t", "{}", `x\n\n${url}\n\ntail text`)
		expect(mid.images).toEqual([])
		const two = presentToolCall("ai-hydro", "t", "{}", `${JSON.stringify({ _run_id: "r" })}\n\n${url}\n\n${url}`)
		expect(two.images).toEqual([url, url])
	})
	it("reads a session id only from the result's own fields", () => {
		expect(presentToolCall("ai-hydro", "t", "{}", JSON.stringify({ session_id: "s1" })).sessionId).toBe("s1")
		expect(presentToolCall("ai-hydro", "t", "{}", JSON.stringify({ data: { session_id: "s2" } })).sessionId).toBe("s2")
		expect(presentToolCall("ai-hydro", "t", "{}", JSON.stringify({ meta: { session_id: "s3" } })).sessionId).toBeUndefined()
	})
	it("surfaces non-zero negative, null and other-qualifier counts only", () => {
		const q = presentToolCall(
			"ai-hydro",
			"t",
			"{}",
			JSON.stringify({
				quality: {
					n_rows: 10,
					approval_counts: { Approved: 10 },
					n_negative: 2,
					n_null_values: 1,
					qualifiers_other: { FOO: 3 },
				},
			}),
		).quality!
		expect(describeQualityExtras(q)).toEqual([
			"2 negative values (kept, not converted)",
			"1 null value dropped",
			"other qualifiers: FOO 3",
		])
		expect(describeQualityExtras({ nNegative: 0, nNullValues: 0, qualifiersOther: {} })).toEqual([])
	})
	it("says dates are not reported when provisional values come without dates", () => {
		expect(describeProvisional({ count: 4, total: 10 })).toBe("provisional 4/10 (dates not reported)")
	})
	it("says the returned data is for the asserted gauge only for honoured assertions", () => {
		expect(assertedGauge({ method: "explicit_id", warnings: [] })).toBe(true)
		expect(assertedGauge({ method: "outlet_snap", warnings: [] })).toBe(false)
	})
	it("takes units only from x-units or an explicit 'units:' phrase", () => {
		const schema = {
			properties: {
				a: { type: "number", "x-units": "m3/s" },
				b: { type: "number", description: "Window length. Units: days" },
				c: { type: "number", description: "A number that might be in metres" },
			},
			required: ["a"],
		}
		const m = presentToolCall("ai-hydro", "t", '{"a":1,"b":2,"c":3}', undefined, undefined, {
			inputSchema: JSON.stringify(schema),
		})
		expect(m.typedArgs.map((a) => a.units)).toEqual(["m3/s", "days", undefined])
		expect(m.typedArgs[0].required).toBe(true)
	})
	it("summarises arrays and objects and shows empty strings", () => {
		const m = presentToolCall("ai-hydro", "t", JSON.stringify({ p: [-90, 40], q: { a: 1 }, r: [{ a: 1 }], s: "" }), undefined)
		expect(m.typedArgs.map((a) => a.value)).toEqual(["[-90,40]", "object with 1 keys", "list of 1", '""'])
	})
})

describe("purpose", () => {
	it("is the first sentence of the first paragraph", () => {
		expect(firstSentence("Extract 17 things (a,\nb). More.\n\nArgs:\n  x: y")).toBe("Extract 17 things (a, b).")
		expect(firstSentence("No full stop here")).toBe("No full stop here")
		expect(firstSentence("   ")).toBeUndefined()
		expect(firstSentence(undefined)).toBeUndefined()
	})
})

describe("server identity and message pairing", () => {
	const call = (ts: number, serverName: string, type = "use_mcp_tool") => ({
		ts,
		say: "use_mcp_server",
		text: JSON.stringify({ serverName, type, toolName: "x" }),
	})
	const res = (ts: number, text: string) => ({ ts, say: "mcp_server_response", text })

	it("recognises only first-party server names", () => {
		expect(isScienceServer("ai-hydro")).toBe(true)
		expect(isScienceServer(" AI-Hydro ")).toBe(true)
		expect(isScienceServer("github")).toBe(false)
		expect(isScienceServer("aihydro-evil")).toBe(false)
		expect(isScienceServer(undefined)).toBe(false)
	})

	it("pairs one outstanding science call with its response, even across sequential calls", () => {
		const msgs = [
			call(1, "ai-hydro"),
			{ ts: 2, say: "mcp_server_request_started" },
			res(3, "A"),
			call(4, "ai-hydro"),
			res(5, "B"),
		]
		const p = pairScienceCalls(msgs)
		expect(p.byCallTs.get(1)).toEqual({ status: "paired", resultText: "A" })
		expect(p.byCallTs.get(4)).toEqual({ status: "paired", resultText: "B" })
		expect([...p.hiddenResponses]).toEqual([2, 4])
	})

	it("leaves a call with no response out of the map (still running)", () => {
		expect(pairScienceCalls([call(1, "ai-hydro")]).byCallTs.size).toBe(0)
	})

	it("never guesses when calls interleave: both calls are unpaired and every response stays visible", () => {
		const p = pairScienceCalls([call(1, "ai-hydro"), call(2, "ai-hydro"), res(3, "A"), res(4, "B")])
		expect(p.byCallTs.get(1)).toEqual({ status: "unpaired" })
		expect(p.byCallTs.get(2)).toEqual({ status: "unpaired" })
		expect(p.hiddenResponses.size).toBe(0)
	})

	it("treats two unanswered calls followed by one response as ambiguous", () => {
		const p = pairScienceCalls([call(1, "ai-hydro"), call(2, "github"), res(3, "A")])
		expect(p.byCallTs.get(1)).toEqual({ status: "unpaired" })
		expect(p.byCallTs.has(2)).toBe(false)
		expect(p.hiddenResponses.size).toBe(0)
	})

	it("keeps an orphan response visible and does not touch later pairs", () => {
		const p = pairScienceCalls([res(1, "orphan"), call(2, "ai-hydro"), res(3, "B")])
		expect(p.hiddenResponses.has(0)).toBe(false)
		expect(p.byCallTs.get(2)).toEqual({ status: "paired", resultText: "B" })
	})

	it("hides only responses of a lone first-party tool call", () => {
		const msgs = [call(1, "github"), res(2, "B"), call(3, "ai-hydro", "access_mcp_resource"), res(4, "C")]
		const p = pairScienceCalls(msgs)
		expect(p.hiddenResponses.size).toBe(0)
		expect(p.byCallTs.size).toBe(0)
	})

	it("computes once per list identity", () => {
		const msgs = [call(1, "ai-hydro"), res(2, "A")]
		expect(getPairing(msgs)).toBe(getPairing(msgs))
		expect(getPairing([...msgs])).not.toBe(getPairing(msgs))
	})
})

describe("ADR-008 b and the S3 reviewer check", () => {
	const source = readFileSync(resolve(__dirname, "../../../../../src/shared/aihydro/toolCallPresenter.ts"), "utf8")
	it("has no tool-name literals", () => {
		expect(source).not.toMatch(/"(data_fetch|fetch_streamflow|delineate)/)
		expect(source).not.toMatch(/'(data_fetch|fetch_streamflow|delineate)/)
	})
	it("imports only the pure server-name list, so it loads without webview or host code", () => {
		const imports = (source.match(/^[ \t]*import\s.*$/gm) ?? []).map((l) => l.trim())
		expect(imports).toEqual(['import { isFirstPartyServerName } from "./firstPartyServers"'])
		expect(source).not.toMatch(/\brequire\(/)
	})
})
