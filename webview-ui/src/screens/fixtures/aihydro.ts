/**
 * Recorded and spliced ai-hydro tool-call bodies for the S3 card tests and harness screens.
 * Provenance of every file is in ./aihydro/README.md. Tests and the harness import from here; production code does not.
 */
import type { ToolAnnotationsInput, ToolMetaInput } from "@shared/aihydro/toolCallPresenter"
import type { McpServer } from "@shared/mcp"
import areaFail from "./aihydro/area_fail_data_fetch.json"
import outletSnap from "./aihydro/outlet_snap_site_resolution.json"
import provisional from "./aihydro/provisional_data_fetch.json"
import refusalArgRepair from "./aihydro/refusal_arg_repair.json"
import refusalRequired from "./aihydro/refusal_gauge_required.json"
import signatures from "./aihydro/signatures_result.json"
import success from "./aihydro/success_data_fetch.json"
import toolsList from "./aihydro/tools_list_2_5_0.json"

export interface RecordedCall {
	/** Tool name as the server registers it (the recorded steps and tools/list entries carry it). */
	toolName: string
	argsJson: string
	/** Response text exactly as the host puts it in the chat: `Error:\n` prefix when the MCP result had isError. */
	resultText: string
	meta: ToolMetaInput
	annotations?: ToolAnnotationsInput
}

type ToolsListEntry = { description?: string | null; inputSchema?: unknown; annotations?: ToolAnnotationsInput | null }
const listing = toolsList as unknown as Record<string, ToolsListEntry>

const call = (toolName: string, args: unknown, result: unknown, isError = false): RecordedCall => {
	const entry = listing[toolName]
	return {
		toolName,
		argsJson: JSON.stringify(args, null, 2),
		resultText: (isError ? "Error:\n" : "") + JSON.stringify(result, null, 2),
		meta: { description: entry?.description ?? undefined, inputSchema: entry?.inputSchema },
		annotations: entry?.annotations ?? undefined,
	}
}

/** Verbatim: e2e-proof-3 (01013500), data_fetch step. */
export const successCall = call("data_fetch", success.args, success.result)
/** Spliced: the success body with the real quality summary of a provisional-bearing recorded series. */
export const provisionalCall = call("data_fetch", provisional.args, provisional.result)
/** Spliced: a real area-check failure record (gauge 01109000 against the 01013500 basin polygon). */
export const areaFailCall = call("data_fetch", areaFail.args, areaFail.result)
/** Real code on recorded bodies: the terminal GAUGE_REQUIRED refusal. */
export const refusalCall = call("data_fetch", refusalRequired.args, refusalRequired.envelope, true)
/** Real middleware output for a toy tool: an error envelope with no `code`. */
export const argRepairRefusal = call("compute_spectral_index", refusalArgRepair.args, refusalArgRepair.envelope, true)
/** Verbatim: e2e-proof-3 (01013500), a result with a run id, a gauge id and no information class. */
export const signaturesCall = call("extract_hydrological_signatures", signatures.args, signatures.result)

export const outletSnapResolution = outletSnap
export const toolsList2_5_0 = toolsList
export { success as successFixture, provisional as provisionalFixture, areaFail as areaFailFixture }

/**
 * Tool names the synthetic transcripts call that the recorded 2.5.0 listing does not contain. They are SYNTHETIC
 * fixture entries (read-only, closed-world annotations) so the transcript presenter can fold their calls the way it
 * would for an annotated trusted server; they say nothing about what the real tools declare.
 */
const SYNTHETIC_READ_TOOLS = [
	"delineate_basin",
	"compute_signatures",
	"extract_hydrologic_signatures",
	"get_forcing",
	"baseflow_separation",
	"flow_duration_curve",
	"trend_analysis",
]

/** The ai-hydro server entry as the webview state would carry it, with the recorded tools/list metadata. */
export const fixtureMcpServers: McpServer[] = [
	{
		name: "ai-hydro",
		config: "{}",
		status: "connected",
		// The host reports first-party trust (isServerTrusted); the transcript only reads annotations for a trusted server.
		trust: { trusted: true, reason: "fixture: first-party launcher matches the recorded launch" },
		tools: Object.entries(listing)
			.map(([name, t]) => ({
				name,
				description: t.description ?? undefined,
				inputSchema: (t.inputSchema ?? undefined) as object | undefined,
				annotations: t.annotations ?? undefined,
			}))
			.concat(
				SYNTHETIC_READ_TOOLS.filter((name) => !(name in listing)).map((name) => ({
					name,
					description: "Synthetic fixture tool (not a recorded listing entry).",
					inputSchema: undefined,
					annotations: { readOnlyHint: true, openWorldHint: false },
				})),
			),
	},
]

/**
 * The first-party server as a real install presents it today: trusted, but its tools publish no annotations, so every
 * call has an undeclared effect. Synthetic tool list (names only); used by the "realistic look" screen.
 */
export const fixtureUnannotatedServers: McpServer[] = [
	{
		name: "ai-hydro",
		config: "{}",
		status: "connected",
		trust: { trusted: true, reason: "fixture: first-party launcher matches the recorded launch" },
		tools: [
			"data_fetch",
			"delineate_basin",
			"compute_signatures",
			"extract_hydrologic_signatures",
			"get_forcing",
			"baseflow_separation",
			"flow_duration_curve",
			"trend_analysis",
		].map((name) => ({ name, description: "Synthetic fixture tool, no annotations." })),
	},
]

/**
 * The first-party server with 2.6.0-style annotations (every tool carries explicit readOnlyHint and destructiveHint):
 * a mix of read-only, session-writing and destructive tools. Tool NAMES are the synthetic transcript's; the
 * annotation mix is illustrative, not the real tools' declarations.
 */
export const fixtureAnnotatedServers: McpServer[] = [
	{
		name: "ai-hydro",
		config: "{}",
		status: "connected",
		trust: { trusted: true, reason: "fixture: first-party launcher matches the recorded launch" },
		tools: [
			["data_fetch", { readOnlyHint: false, destructiveHint: false, openWorldHint: false }],
			["delineate_basin", { readOnlyHint: true, destructiveHint: false, openWorldHint: false }],
			["compute_signatures", { readOnlyHint: true, destructiveHint: false, openWorldHint: false }],
			["extract_hydrologic_signatures", { readOnlyHint: true, destructiveHint: false, openWorldHint: false }],
			["get_forcing", { readOnlyHint: false, destructiveHint: false, openWorldHint: false }],
			["baseflow_separation", { readOnlyHint: true, destructiveHint: false, openWorldHint: false }],
			["flow_duration_curve", { readOnlyHint: true, destructiveHint: false, openWorldHint: false }],
			["trend_analysis", { readOnlyHint: false, destructiveHint: true, openWorldHint: false }],
		].map(([name, annotations]) => ({
			name: name as string,
			description: "Synthetic fixture tool.",
			annotations: annotations as { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean },
		})),
	},
]

/** Two tools under per-tool "always allow" (the `autoApprove` grant), for the composer's risk marker. */
export const fixtureAlwaysAllowServers: McpServer[] = [
	{
		name: "fixture-notes",
		config: "{}",
		status: "connected",
		tools: [
			{ name: "append_note", description: "Synthetic fixture tool.", autoApprove: true },
			{ name: "delete_note", description: "Synthetic fixture tool.", autoApprove: true },
			{ name: "list_notes", description: "Synthetic fixture tool.", autoApprove: false },
		],
	},
]
