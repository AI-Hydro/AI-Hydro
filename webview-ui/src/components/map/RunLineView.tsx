/**
 * The Run line: the first line of a layer's drawer, above Opacity. It is always there, so a user learns that a layer's
 * run can open (or that it has none) without hunting through menus. The wording comes from `runLine.ts`. What a changed
 * file means for the run is said by `SourceNote` (`sourceNoteText.ts`), the one place that knows whether the layer holds
 * a copy of the run's result.
 */

import type { MapLayer } from "@shared/proto/cline/map"
import React from "react"
import { runLineOf } from "./runLine"

export const RunLineView: React.FC<{ layer: MapLayer; onOpenRun: () => void }> = ({ layer, onOpenRun }) => {
	const line = runLineOf(layer)
	return (
		<div aria-label="Run" className="map-layer-run" role="group">
			<div className="map-layer-run__line">
				<span aria-hidden="true" className="codicon codicon-history" />
				<span className="map-layer-run__text" title={line.text}>
					{line.text}
				</span>
				{line.kind === "openable" && (
					<button className="map-chip" onClick={onOpenRun} type="button">
						Open run
					</button>
				)}
			</div>
		</div>
	)
}
