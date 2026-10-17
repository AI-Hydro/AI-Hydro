/** Synthetic experiment tables (host `experiment_table_data` payloads). Numbers are invented. */
import { FIXTURE_SESSION } from "./claims"

const defn = (id: string, features: string[]) => ({
	experiment_id: id,
	name: "Synthetic signature comparison",
	tool: "compute_signatures",
	features,
	params: { method: "fixture", window: "synthetic" },
	metrics: ["nse", "kge", "bias"],
	params_hash: "fxhash0001",
	created_at: "2026-10-01T12:00:00Z",
})

const features = ["SYN-00000001", "SYN-00000002", "SYN-00000003", "SYN-00000004"]
const cell = (value: number | null, ci?: [number, number], run?: string) => ({
	value,
	...(ci ? { ci_low: ci[0], ci_high: ci[1] } : {}),
	run_id: run ?? null,
})

export const experimentWithCi = {
	type: "experiment_table_data",
	session_id: FIXTURE_SESSION,
	experiment_id: "fx-exp-ci",
	available_experiment_ids: ["fx-exp-ci", "fx-exp-noci", "fx-exp-failed"],
	defn: defn("fx-exp-ci", features),
	results: {
		status: "complete",
		run_ids: Object.fromEntries(features.map((f, i) => [f, `fx-run-10${i}`])),
		cells: {
			"SYN-00000001": {
				nse: cell(0.71, [0.62, 0.79], "fx-run-100"),
				kge: cell(0.66, [0.55, 0.74], "fx-run-100"),
				bias: cell(-0.04, [-0.1, 0.02], "fx-run-100"),
			},
			"SYN-00000002": {
				nse: cell(0.38, [0.21, 0.52], "fx-run-101"),
				kge: cell(0.44, [0.3, 0.57], "fx-run-101"),
				bias: cell(0.12, [0.03, 0.2], "fx-run-101"),
			},
			"SYN-00000003": {
				nse: cell(-0.15, [-0.4, 0.05], "fx-run-102"),
				kge: cell(0.1, [-0.1, 0.28], "fx-run-102"),
				bias: cell(0.31, [0.2, 0.43], "fx-run-102"),
			},
			"SYN-00000004": {
				nse: cell(0.55, [0.41, 0.66], "fx-run-103"),
				kge: cell(0.52, [0.4, 0.63], "fx-run-103"),
				bias: cell(0.0, [-0.07, 0.07], "fx-run-103"),
			},
		},
		errors: {},
		n_success: 4,
		n_error: 0,
		completed_at: "2026-10-01T12:30:00Z",
	},
}

export const experimentNoCi = {
	...experimentWithCi,
	experiment_id: "fx-exp-noci",
	defn: defn("fx-exp-noci", features),
	results: {
		...experimentWithCi.results,
		cells: Object.fromEntries(
			Object.entries(experimentWithCi.results.cells).map(([f, row]) => [
				f,
				Object.fromEntries(Object.entries(row).map(([m, c]) => [m, cell(c.value, undefined, c.run_id ?? undefined)])),
			]),
		),
	},
}

export const experimentFailed = {
	...experimentWithCi,
	experiment_id: "fx-exp-failed",
	defn: defn("fx-exp-failed", features),
	results: {
		status: "partial",
		run_ids: { "SYN-00000001": "fx-run-100", "SYN-00000002": "fx-run-101" },
		cells: {
			"SYN-00000001": experimentWithCi.results.cells["SYN-00000001"],
			"SYN-00000002": { nse: cell(null), kge: cell(null), bias: cell(null) },
			"SYN-00000003": { nse: cell(null), kge: cell(null), bias: cell(null) },
			"SYN-00000004": experimentWithCi.results.cells["SYN-00000004"],
		},
		errors: {
			"SYN-00000002": "GAUGE_NOT_FOUND: no gauge matches the identifier",
			"SYN-00000003": "Upstream request failed (synthetic error text)",
		},
		n_success: 2,
		n_error: 2,
		completed_at: "2026-10-01T12:31:00Z",
	},
}
