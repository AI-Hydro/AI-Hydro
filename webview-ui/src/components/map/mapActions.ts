/**
 * One action list for the map's selection card and its context menu.
 *
 * What you can do to a thing on the map does not depend on how you reached it. `mapActions(kind, surface)` is the
 * only place that says which actions an object has and what each is called; the card (FeatureIdentifier), the
 * context menu and the pin card render from it and wire a handler to each id. One label per verb:
 * "Ask AI-Hydro", "Delineate", "Delineate without chat".
 *
 * The one rule that depends on the surface: the card is what "Inspect" opens, so the card does not list it.
 */

import type { ClickedFeature, MapInspectPoint } from "./FeatureIdentifier"

export type MapObjectKind = "gauge" | "river" | "basin" | "feature" | "pin" | "empty"

export type MapActionId =
	| "ask"
	| "delineate"
	| "delineate-quick"
	| "inspect"
	| "select"
	| "export-geojson"
	| "export-shapefile"
	| "remove-layer"
	| "rename-pin"
	| "remove-pin"
	| "add-pin"
	| "measure"
	| "copy-coords"

/** Where an action sits in the context menu's groups. The card shows the first two "ai" actions, the rest under `...`. */
export type MapActionSection = "ai" | "pin" | "object" | "map"

export interface MapAction {
	id: MapActionId
	label: string
	icon: string
	section: MapActionSection
	danger?: boolean
	/** What it does, for the tooltip. The card carries no explanatory paragraph. */
	tooltip?: string
}

export const MAP_ACTIONS: Record<MapActionId, Omit<MapAction, "id">> = {
	ask: {
		label: "Ask AI-Hydro",
		icon: "sparkle",
		section: "ai",
		tooltip: "Ask the agent about this place, its layers or next steps",
	},
	delineate: {
		label: "Delineate",
		icon: "symbol-field",
		section: "ai",
		tooltip: "Opens a chat and the agent delineates the watershed; the run is recorded",
	},
	"delineate-quick": {
		label: "Delineate without chat",
		icon: "zap",
		section: "ai",
		tooltip:
			"Runs here with no chat, on the MERIT flow-direction raster. Best for small and medium basins; use Delineate for a large one",
	},
	inspect: { label: "Inspect", icon: "search", section: "object" },
	select: {
		label: "Select",
		icon: "add",
		section: "object",
		tooltip: "Add this feature to the selection set. Shift-click features on the map to add or remove quickly",
	},
	"export-geojson": {
		label: "Save as GeoJSON",
		icon: "export",
		section: "object",
		tooltip: "Save to vectors/ in the workspace",
	},
	"export-shapefile": {
		label: "Save as shapefile",
		icon: "file-zip",
		section: "object",
		tooltip: "Save a zipped shapefile to vectors/",
	},
	"remove-layer": {
		label: "Remove layer",
		icon: "trash",
		section: "object",
		danger: true,
		tooltip: "Remove this layer from the map",
	},
	"rename-pin": { label: "Rename pin", icon: "edit", section: "pin" },
	"remove-pin": { label: "Remove pin", icon: "trash", section: "pin", danger: true },
	"add-pin": { label: "Add pin", icon: "pin", section: "map" },
	measure: { label: "Measure from here", icon: "symbol-ruler", section: "map" },
	"copy-coords": { label: "Copy coordinates", icon: "copy", section: "map" },
}

const POINT_ACTIONS: MapActionId[] = ["add-pin", "measure", "copy-coords"]
const AI: MapActionId[] = ["ask", "delineate", "delineate-quick"]

const BY_KIND: Record<MapObjectKind, MapActionId[]> = {
	empty: [...AI, ...POINT_ACTIONS],
	gauge: [...AI, "inspect", "select", "export-geojson", "export-shapefile", "remove-layer", ...POINT_ACTIONS],
	river: [...AI, "inspect", "select", "export-geojson", "remove-layer", ...POINT_ACTIONS],
	basin: [...AI, "inspect", "select", "export-geojson", "export-shapefile", "remove-layer", ...POINT_ACTIONS],
	feature: [...AI, "inspect", "select", "export-geojson", "export-shapefile", "remove-layer", ...POINT_ACTIONS],
	pin: ["ask", "delineate", "rename-pin", "copy-coords", "remove-pin"],
}

export type MapActionSurface = "card" | "menu"

export function mapActions(kind: MapObjectKind, surface: MapActionSurface = "menu"): MapAction[] {
	return BY_KIND[kind].filter((id) => !(surface === "card" && id === "inspect")).map((id) => ({ id, ...MAP_ACTIONS[id] }))
}

export const actionLabel = (id: MapActionId): string => MAP_ACTIONS[id].label

/** What kind of thing a click found. A pin wins over what lies under it. */
export function objectKind(features: ClickedFeature[], hasPin = false): MapObjectKind {
	if (hasPin) return "pin"
	if (features.length === 0) return "empty"
	const props = features[0].properties
	if (props.site_no != null || props.siteNo != null || props.monitoring_location_id != null) return "gauge"
	if (props.area_km2 != null && (props.method != null || props.pfaf != null || props.routing != null)) return "basin"
	if (props.uparea != null || props.strmOrder != null || props.COMID != null || props.comid != null) return "river"
	return "feature"
}

/** What a kind is called on the card. */
export const KIND_LABEL: Record<MapObjectKind, string> = {
	gauge: "Gauge",
	river: "River reach",
	basin: "Basin",
	feature: "Feature",
	pin: "Pin",
	empty: "Map point",
}

const QUICK_DELINEATE_MAX_MERIT_UPAREA_KM2 = 50_000

function numberProp(props: Record<string, unknown> | undefined, keys: string[]): number | undefined {
	if (!props) return undefined
	for (const key of keys) {
		const value = props[key]
		if (typeof value === "number" && Number.isFinite(value)) return value
		if (typeof value === "string") {
			const parsed = Number(value)
			if (Number.isFinite(parsed)) return parsed
		}
	}
	return undefined
}

/** How a delineation here would be routed, as one sentence for the Delineate tooltip. */
export function routingNote(feature: ClickedFeature | undefined, point: MapInspectPoint | null | undefined): string | undefined {
	if (!point) return undefined
	if (point.lat >= 24 && point.lat <= 50 && point.lon >= -125 && point.lon <= -66.5) {
		return "Routing: NLDI first. A CONUS outlet tries NLDI/NHDPlus before the MERIT fallback."
	}
	const uparea = numberProp(feature?.properties, ["uparea", "UPAREA", "upArea", "UpArea"])
	if (uparea && uparea > QUICK_DELINEATE_MAX_MERIT_UPAREA_KM2) {
		return "Routing: hybrid. A large MERIT basin needs Delineate so the MERIT-Basins hybrid workflow can run safely."
	}
	if (uparea && uparea > 0) return "Routing: quick MERIT. The basin is within the interactive MERIT flow-direction envelope."
	return "Routing: outlet check. Click a MERIT river or catchment feature for area-aware routing guidance."
}

/** The routing note when it is a warning the user must read before choosing (a large basin), not just a hint. */
export function routingWarning(
	feature: ClickedFeature | undefined,
	point: MapInspectPoint | null | undefined,
): string | undefined {
	const note = routingNote(feature, point)
	return note?.startsWith("Routing: hybrid") ? note : undefined
}

/** The tooltip of an action at a point, with the routing note on the delineate verbs. */
export function actionTooltip(id: MapActionId, feature?: ClickedFeature, point?: MapInspectPoint | null): string | undefined {
	const base = MAP_ACTIONS[id].tooltip
	if (id !== "delineate" && id !== "delineate-quick") return base
	const route = routingNote(feature, point)
	return route ? `${base}. ${route}` : base
}
