/** Synthetic replay payloads (host `replay_data`). Outputs are invented placeholders. */
import { FIXTURE_SESSION } from "./claims"

const entry = (n: number, tool: string, extra: Record<string, unknown> = {}) => ({
	run_id: `fx-run-000${n}`,
	tool_name: tool,
	session_id: FIXTURE_SESSION,
	timestamp: `2026-10-01T1${n}:00:00Z`,
	key_outputs: { synthetic_value: n },
	inputs: { gauge_id: "SYN-00000001" },
	evidence: {
		quality_flags: [
			{ validator: "record-length", status: "pass" },
			{ validator: "stationarity", status: "warn" },
		],
	},
	diff_status: "match",
	...extra,
})

const entries = [
	entry(1, "delineate_watershed"),
	entry(2, "fetch_streamflow", {
		evidence: { quality_flags: [{ validator: "qual-codes", status: "fail" }] },
		diff_status: "mismatch",
		diff_notes: ["recorded digest differs from recomputed digest (synthetic)"],
	}),
	entry(3, "compute_signatures", { diff_status: "missing", diff_notes: ["no recorded counterpart"] }),
	entry(4, "list_tools", { minimal: true, key_outputs: {} }),
]

export const replaySession = {
	type: "replay_data",
	session_id: FIXTURE_SESSION,
	source: "session",
	entries,
	session_path: "/fixture/sessions/fx-session-001.json",
}
export const replayCapsule = {
	type: "replay_data",
	session_id: FIXTURE_SESSION,
	source: "capsule",
	entries,
	capsule_path: "/fixture/capsules/fx-capsule-001",
}
export const replayMismatch = {
	...replaySession,
	entries: entries.map((e) => ({ ...e, diff_status: "mismatch", diff_notes: ["synthetic mismatch note"] })),
}
export const replayMissing = {
	...replaySession,
	entries: entries.map((e) => ({ ...e, diff_status: "missing", diff_notes: ["synthetic missing counterpart"] })),
}
export const replayNoTimezone = {
	...replaySession,
	entries: entries.map((e) => ({ ...e, timestamp: e.timestamp.replace("Z", "") })),
}
export const replayWarnings = { ...replaySession, warnings: ["Synthetic loader warning: two records skipped."] }
