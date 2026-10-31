/**
 * The feature identify card for the UI harness (dev-only): the real FeatureIdentifier with a selected feature, a click
 * point and a raster reading. A canvas click does not reach deck.gl in the harness, so the card cannot be opened through
 * the map; this is the test seam, and the card is the production component.
 */
import FeatureIdentifier, { type ClickedFeature } from "../components/map/FeatureIdentifier"

const features: ClickedFeature[] = [
	{
		layerId: "fx-basin",
		layerName: "Synthetic basin SYN-00000001",
		properties: {
			name: "Synthetic basin",
			area_km2: 412.7,
			source_status: "synthetic",
			tool: "delineate_watershed",
			method: "nldi",
			pfaf: "7",
			outlet: "SYN-00000001",
			perimeter_km: 98.2,
		},
		geometry: { type: "Point", coordinates: [-89.95, 39] },
	},
	{ layerId: "fx-rivers", layerName: "Synthetic river lines", properties: { order: 2 }, geometry: undefined },
]

export function MapIdentifyScreen() {
	return (
		<div style={{ position: "relative", height: "100%", minHeight: 520, background: "var(--vscode-editor-background)" }}>
			<FeatureIdentifier
				features={features}
				inspectPoint={{ lon: -89.95, lat: 39 }}
				layerMetadata={(id) =>
					id === "fx-basin"
						? { tool: "delineate_watershed", _run_id: "fx-run-0003", study_id: "fx-study", source: "tool" }
						: undefined
				}
				mapStyle="dark"
				onAddSelection={() => {}}
				onAgentAsk={() => {}}
				onAgentDelineate={() => {}}
				onClose={() => {}}
				onQuickDelineate={() => {}}
				onSaveFeatures={() => {}}
				rasterReading={{ layerName: "Synthetic raster", value: 118.4, units: "synthetic units" } as never}
			/>
		</div>
	)
}

const gaugeFeatures: ClickedFeature[] = [
	{
		layerId: "fx-ref-gauges",
		layerName: "NWIS gauges in view",
		properties: { site_no: "SYN-00000001", name: "Synthetic gauge", label: "SYN-00000001 — Synthetic gauge" },
		geometry: { type: "Point", coordinates: [-89.9, 38.85] },
	},
]

/** A clicked gauge from the Reference tab: the layer reports site and name only, so the rest reads "not reported". */
export function MapIdentifyGaugeScreen() {
	return (
		<div style={{ position: "relative", height: "100%", minHeight: 520, background: "var(--vscode-editor-background)" }}>
			<FeatureIdentifier
				features={gaugeFeatures}
				inspectPoint={{ lon: -89.9, lat: 38.85 }}
				layerMetadata={() => ({ source: "nwis" })}
				mapStyle="dark"
				onAddSelection={() => {}}
				onAgentAsk={() => {}}
				onAgentDelineate={() => {}}
				onClose={() => {}}
				onQuickDelineate={() => {}}
				onSaveFeatures={() => {}}
			/>
		</div>
	)
}
