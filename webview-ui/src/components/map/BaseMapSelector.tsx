import React from "react"

export interface BaseMapStyle {
	id: string
	name: string
	url: string
	attribution?: string
	requiresToken?: boolean
}

export const BASE_MAP_STYLES: BaseMapStyle[] = [
	// Hydrology-specific (most relevant for AI-Hydro)
	{
		id: "usgs-topo",
		name: "🗺️ USGS Topo",
		url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
		attribution: "USGS The National Map",
	},
	{
		id: "usgs-imagery",
		name: "🛰️ USGS Imagery",
		url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
		attribution: "USGS The National Map",
	},
	{
		id: "usgs-shaded-relief",
		name: "🏔️ USGS Shaded Relief",
		url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}",
		attribution: "USGS The National Map",
	},
	// General purpose
	{
		id: "carto-dark",
		name: "🌙 Dark",
		url: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
		attribution: "© OpenStreetMap © CartoDB",
	},
	{
		id: "carto-light",
		name: "☀️ Light",
		url: "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
		attribution: "© OpenStreetMap © CartoDB",
	},
	{
		id: "osm",
		name: "🗺️ OpenStreetMap",
		url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
		attribution: "© OpenStreetMap contributors",
	},
	{
		id: "esri-imagery",
		name: "🛰️ Esri Satellite",
		url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
		attribution: "© Esri",
	},
	{
		// Stamen Terrain moved to Stadia Maps in 2023 — old fastly URL is dead
		id: "stadia-terrain",
		name: "⛰️ Terrain",
		url: "https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.jpg",
		attribution: "© Stadia Maps © Stamen Design © OpenStreetMap",
	},
	{
		id: "osm-hot",
		name: "🚑 Humanitarian",
		url: "https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
		attribution: "© OpenStreetMap © HOT",
	},
	// Mapbox styles (require token)
	{
		id: "mapbox-dark",
		name: "🌃 Mapbox Dark",
		url: "mapbox://styles/mapbox/dark-v10",
		requiresToken: true,
	},
	{
		id: "mapbox-light",
		name: "🏙️ Mapbox Light",
		url: "mapbox://styles/mapbox/light-v10",
		requiresToken: true,
	},
	{
		id: "mapbox-outdoors",
		name: "🏞️ Mapbox Outdoors",
		url: "mapbox://styles/mapbox/outdoors-v10",
		requiresToken: true,
	},
	{
		id: "mapbox-satellite",
		name: "🌍 Mapbox Satellite",
		url: "mapbox://styles/mapbox/satellite-v9",
		requiresToken: true,
	},
]

interface BaseMapSelectorProps {
	currentStyle: string
	onStyleChange: (styleId: string) => void
	hasMapboxToken: boolean
	mapStyle?: "light" | "dark"
}

export const BaseMapSelector: React.FC<BaseMapSelectorProps> = ({
	currentStyle,
	onStyleChange,
	hasMapboxToken,
	mapStyle = "dark",
}) => {
	// Filter out Mapbox styles if no token available
	const availableStyles = BASE_MAP_STYLES.filter((style) => !style.requiresToken || hasMapboxToken)

	return (
		<div
			style={{
				position: "absolute",
				top: "10px",
				right: "10px",
				zIndex: 1000,
				backgroundColor: mapStyle === "dark" ? "rgba(30, 30, 30, 0.95)" : "rgba(255, 255, 255, 0.95)",
				borderRadius: "4px",
				boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
				border: `1px solid ${mapStyle === "dark" ? "#444" : "#ddd"}`,
			}}>
			<select
				onChange={(e) => onStyleChange(e.target.value)}
				style={{
					padding: "8px 12px",
					fontSize: "13px",
					border: "none",
					borderRadius: "4px",
					backgroundColor: "transparent",
					color: mapStyle === "dark" ? "#fff" : "#000",
					cursor: "pointer",
					outline: "none",
					minWidth: "180px",
				}}
				title="Select Base Map"
				value={currentStyle}>
				{availableStyles.map((style) => (
					<option key={style.id} value={style.id}>
						{style.name}
					</option>
				))}
			</select>

			{!hasMapboxToken && (
				<div
					style={{
						padding: "8px 12px",
						fontSize: "11px",
						color: mapStyle === "dark" ? "#888" : "#666",
						borderTop: `1px solid ${mapStyle === "dark" ? "#444" : "#ddd"}`,
						fontStyle: "italic",
					}}>
					💡 Add Mapbox token for more styles
				</div>
			)}
		</div>
	)
}

export default BaseMapSelector
