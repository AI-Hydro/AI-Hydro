import { stampedFactKeys, withoutFactStamp } from "@shared/map/provenanceEnvelope"
import { MapLayer } from "@shared/proto/cline/map"

/**
 * The `_fact_keys` stamp says which of a layer's fact keys were recorded with the run that made it. Only the host's own
 * add-from-run path, a restore of its own catalog, and Undo of a layer it just removed (`prior` is then the removed layer, kept host-side) may bring one in; every other add loses it, so a plain add cannot make
 * its metadata look recorded.
 *
 * The one exception is the same layer re-sent unchanged (a style edit): the same geometry, fact values, `_run_id` and `tool` keep the
 * stamp the layer already has. This is a convention between the host's own paths, not a signature: a layer catalog file
 * edited on disk can still forge it.
 */
export function applyFactStampPolicy(prior: MapLayer | undefined, layer: MapLayer, trusted: boolean): MapLayer {
	if (trusted || !layer.metadata?._fact_keys) return layer
	const unchanged =
		!!prior?.metadata?._fact_keys &&
		prior.geojson === layer.geojson &&
		prior.metadata?._run_id === layer.metadata?._run_id &&
		prior.metadata?.tool === layer.metadata?.tool &&
		stampedFactKeys(prior.metadata).every((k) => prior.metadata?.[k] === layer.metadata?.[k])
	const metadata = withoutFactStamp(layer.metadata)
	if (unchanged && prior?.metadata) metadata._fact_keys = prior.metadata._fact_keys
	return MapLayer.create({ ...layer, metadata })
}
