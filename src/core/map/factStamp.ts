import { stampedFactKeys, withoutFactStamp } from "@shared/map/provenanceEnvelope"
import { MapLayer } from "@shared/proto/cline/map"

/**
 * The `_fact_keys` stamp says which of a layer's fact keys were recorded with the run that made it. Only the host's own
 * add-from-run path (and a restore of what it wrote) may bring one in; every other add loses it, so a plain add cannot make
 * its metadata look recorded.
 *
 * The one exception is the same layer re-sent unchanged (a style edit): the same geometry and the same fact values keep the
 * stamp the layer already has. This is a convention between the host's own paths, not a signature: a layer catalog file
 * edited on disk can still forge it.
 */
export function applyFactStampPolicy(prior: MapLayer | undefined, layer: MapLayer, trusted: boolean): MapLayer {
	if (trusted || !layer.metadata?._fact_keys) return layer
	const unchanged =
		!!prior?.metadata?._fact_keys &&
		prior.geojson === layer.geojson &&
		stampedFactKeys(prior.metadata).every((k) => prior.metadata?.[k] === layer.metadata?.[k])
	const metadata = withoutFactStamp(layer.metadata)
	if (unchanged && prior?.metadata) metadata._fact_keys = prior.metadata._fact_keys
	return MapLayer.create({ ...layer, metadata })
}
