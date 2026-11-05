/**
 * Captured from the real tools: gauge_flowlines then map_add_layer_from_run (aihydro-tools vision2040/flowline-layer-meta, the test over tests/test_gauge_flowlines.py), NLDI answers faked in that test. 'provenance' is the add_layer_from_run envelope as the host receives it; the host adds session_id.
 */
export const gaugeFlowlinesEnvelope: Record<string, string> = {
	_run_id: "gauge.20261102.seriess.a6c7a875",
	study_id: "series-session",
	tool: "gauge_flowlines",
	source: "aihydro:gauge_flowlines",
	retrieved_at: "2026-11-02T03:15:31.840653+00:00",
	gauge_id: "01031500",
	direction: "upstream",
	distance_km: "20",
	truncated: "false",
	n_features: "3",
}
