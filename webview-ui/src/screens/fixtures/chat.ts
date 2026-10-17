/** Synthetic chat transcripts (invented; no model produced these). */
import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { FIXTURE_NOW, fixtureHistory } from "./state"

const t0 = FIXTURE_NOW - 600_000
const step = 4_000

const apiReq = (ts: number, cost = 0.0123): AiHydroMessage => ({
	ts,
	type: "say",
	say: "api_req_started",
	text: JSON.stringify({ request: "fixture request", tokensIn: 12_400, tokensOut: 640, cacheReads: 8_000, cost }),
})
const task = (text: string): AiHydroMessage => ({ ts: t0, type: "say", say: "task", text })
const text = (ts: number, body: string): AiHydroMessage => ({ ts, type: "say", say: "text", text: body })
const mcpCall = (ts: number, toolName: string, args: Record<string, unknown>): AiHydroMessage => ({
	ts,
	type: "say",
	say: "use_mcp_server",
	text: JSON.stringify({ serverName: "ai-hydro", type: "use_mcp_tool", toolName, arguments: JSON.stringify(args, null, 2) }),
})
const mcpResult = (ts: number, body: unknown): AiHydroMessage => ({
	ts,
	type: "say",
	say: "mcp_server_response",
	text: typeof body === "string" ? body : JSON.stringify(body, null, 2),
})
const completion = (ts: number, body: string): AiHydroMessage => ({ ts, type: "say", say: "completion_result", text: body })

export const taskItem = fixtureHistory[0]

export const plainTextTask: AiHydroMessage[] = [
	task("Explain what a flow-duration curve tells me. This is a layout fixture, not a hydrology answer."),
	apiReq(t0 + step),
	text(
		t0 + 2 * step,
		"A flow-duration curve ranks streamflow values from highest to lowest and plots them against the percentage of time each value is equalled or exceeded.\n\nFixture text only: it exists to exercise the chat row layout.",
	),
]

export const mcpCallTask: AiHydroMessage[] = [
	task("Delineate the catchment for the synthetic gauge SYN-00000001."),
	apiReq(t0 + step),
	mcpCall(t0 + 2 * step, "delineate_watershed", { gauge_id: "SYN-00000001", method: "fixture" }),
	mcpResult(t0 + 3 * step, {
		_run_id: "fx-run-0001",
		basin_ref: { label: "Synthetic basin 001", gauge_id: "SYN-00000001" },
		area_km2: "not a real value",
		metadata: { source_status: "synthetic" },
	}),
	apiReq(t0 + 4 * step),
]

export const refusalTask: AiHydroMessage[] = [
	task("Fetch streamflow for the station named Fixture Creek."),
	apiReq(t0 + step),
	mcpCall(t0 + 2 * step, "fetch_streamflow", { site_name: "Fixture Creek" }),
	mcpResult(t0 + 3 * step, {
		isError: true,
		error: "GAUGE_AMBIGUOUS",
		code: "GAUGE_AMBIGUOUS",
		message: "Two candidate gauges match the name; refusing to guess.",
		recovery: "Pass an explicit gauge_id from the candidates list, or ask the user which gauge is intended.",
		candidates: [{ site: "SYN-00000001" }, { site: "SYN-00000002" }],
		example_call: { gauge_id: "SYN-00000001" },
	}),
	apiReq(t0 + 4 * step),
	text(t0 + 5 * step, "The lookup stopped because the station name matches more than one gauge. Which gauge do you mean?"),
]

export const finalAnswerTask: AiHydroMessage[] = [
	task("Summarise the synthetic basin signatures with evidence."),
	apiReq(t0 + step),
	mcpCall(t0 + 2 * step, "compute_signatures", { gauge_id: "SYN-00000001" }),
	mcpResult(t0 + 3 * step, { _run_id: "fx-run-0003", signatures: { note: "synthetic" } }),
	apiReq(t0 + 4 * step),
	completion(
		t0 + 5 * step,
		"The synthetic baseflow index is reported in [run:fx-run-0003#signatures.bfi]. See claim [claim:fx-claim-supported] for the recorded status .\n\nFixture answer: no value here is a result.",
	),
]
