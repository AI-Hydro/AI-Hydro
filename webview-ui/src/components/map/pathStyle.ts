import { PathStyleExtension } from "@deck.gl/extensions"

/**
 * deck.gl draws dashed lines only through PathStyleExtension, and the prop is `getDashArray` ([dash, gap] in
 * line-width units). A bare `dashArray` prop is ignored, which is why transect and "modelled" lines were
 * always solid. Pass `extensions: [DASH_EXTENSION]` plus `getDashArray` on a PathLayer / GeoJsonLayer.
 */
export const DASH_EXTENSION = new PathStyleExtension({ dash: true })

/** Pattern for modelled (non-observed) lines, see design/evidenceStates.ts. */
export const DASHED: [number, number] = [6, 4]
