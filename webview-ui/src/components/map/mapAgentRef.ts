import type { MapRef } from "@shared/map/mapRef"
import { layerRunId } from "@shared/map/provenanceEnvelope"
import type { MapLayer } from "@shared/proto/cline/map"
import type { ClickedFeature } from "./FeatureIdentifier"
import { objectKind } from "./mapActions"

/** An id the feature carries on its own. No id means no key: a slice of its geometry would not be a reference. */
function featureKeyOf(feature: ClickedFeature): string | undefined {
	const p = feature.properties ?? {}
	const id = p.COMID ?? p.comid ?? p.site_no ?? p.siteNo ?? p.huc12 ?? p.HUC12 ?? p.id ?? p.ID ?? p.name ?? p.Name
	return id === undefined || id === null || id === "" ? undefined : String(id)
}

/** What the user pointed at: the first clicked feature's layer, run and study, the place, and a pin when it is one. */
export function buildMapRef(input: {
	point: { lon: number; lat: number }
	features: ClickedFeature[]
	layers: MapLayer[]
	pinId?: string
}): MapRef {
	const { point, features, layers, pinId } = input
	const primary = features[0]
	const layer = primary ? layers.find((l) => l.id === primary.layerId) : undefined
	const meta = layer?.metadata
	return {
		kind: objectKind(features, !!pinId),
		...(primary ? { layer_id: primary.layerId, layer_name: primary.layerName } : {}),
		...(layerRunId(meta) ? { run_id: layerRunId(meta) } : {}),
		// `study_id` is the envelope key; `session_id` is the older catalogue key for the same thing.
		...(meta?.study_id || meta?.session_id ? { study_id: meta?.study_id || meta?.session_id } : {}),
		...(pinId ? { feature_key: pinId } : primary && featureKeyOf(primary) ? { feature_key: featureKeyOf(primary) } : {}),
		lon: point.lon,
		lat: point.lat,
	}
}
