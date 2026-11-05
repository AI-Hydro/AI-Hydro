/**
 * Mock, not the shipped design: the alternative the owner can compare against. Here a file MOVES between two sections
 * when it is loaded (On the map above, Not on the map below), instead of staying in the Project files tree with a check.
 * Static markup on the panel's own classes; nothing here is wired to the host.
 */
import React from "react"

const Row: React.FC<{ name: string; size: string; action?: string; check?: boolean }> = ({ name, size, action, check }) => (
	<div className="map-pf-row">
		<span className="map-pf-name map-pf-name--static">
			<span aria-hidden="true" className="codicon codicon-json" />
			<span className="map-pf-name__text">{name}</span>
		</span>
		<span className="map-pf-meta">{size}</span>
		{check && (
			<span aria-label="Loaded" className="map-pf-check" role="img">
				<span aria-hidden="true" className="codicon codicon-check" />
			</span>
		)}
		<button className="map-chip" type="button">
			{action ?? "Load"}
		</button>
	</div>
)

export const MapLayersMovingRowScreen: React.FC = () => (
	<div
		className="map-layers"
		style={{ width: 360, height: 420, background: "var(--vscode-sideBar-background, var(--vscode-editor-background))" }}>
		<div className="map-layers__toolbar">
			<strong>Alternative (mock): rows move between sections</strong>
		</div>
		<div className="map-layers__list">
			<h3 className="map-layers__section">On the map</h3>
			<Row action="Unload" name="huc8_boundaries.geojson" size="1.2 MB" />
		</div>
		<section aria-label="Not on the map" className="map-pf" data-open>
			<button aria-expanded="true" className="map-layer-group__head map-pf__head" type="button">
				<span aria-hidden="true" className="codicon codicon-chevron-down" />
				<span className="map-layer-group__title">Not on the map (2)</span>
			</button>
			<div className="map-pf__body">
				<Row name="gauges.geojson" size="96 KB" />
				<Row name="active.json" size="3 KB" />
			</div>
		</section>
	</div>
)
