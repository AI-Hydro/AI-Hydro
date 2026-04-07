import React from "react"
import { MapView } from "./MapView"

/**
 * MapPanel component - container for the Map tab
 * Integrates MapView into the AI-Hydro tab system
 */
export const MapPanel: React.FC = () => {
	return (
		<div
			className="map-panel"
			style={{
				width: "100%",
				height: "100%",
				overflow: "hidden",
			}}>
			<MapView />
		</div>
	)
}

export default MapPanel
