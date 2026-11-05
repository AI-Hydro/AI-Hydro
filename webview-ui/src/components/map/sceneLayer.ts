import { withoutFactStamp } from "@shared/map/provenanceEnvelope"
import type { MapLayer } from "@shared/proto/cline/map"

/**
 * A layer from a map scene file, as it is sent to the host. A scene file is shared and edited by hand, so it never brings
 * the `_fact_keys` stamp in: a trace layer opened from a scene reads "not recorded". Everything else in the layer is
 * sent as it is.
 */
export function sceneLayerForOpen(layer: MapLayer): MapLayer {
	if (!layer?.metadata || !("_fact_keys" in layer.metadata)) return layer
	return { ...layer, metadata: withoutFactStamp(layer.metadata) }
}
