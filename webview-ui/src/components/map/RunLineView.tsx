/**
 * The Run line: the first line of a layer's drawer, above Opacity. It is always there, so a user learns that a layer's
 * run can open (or that it has none) without hunting through menus. The wording comes from `runLine.ts`.
 */

import type { MapLayer } from "@shared/proto/cline/map"
import React from "react"
import { CHANGED_AFTER_RUN, changedAfterRun, runLineOf } from "./runLine"

export const RunLineView: React.FC<{
	layer: MapLayer
	onOpenRun: () => void
	/** Ask to take the changed file. Given only when the host can read it. */
	onUseNewFile?: () => void
}> = ({ layer, onOpenRun, onUseNewFile }) => {
	const line = runLineOf(layer)
	const changed = changedAfterRun(layer)
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
			{changed && (
				<div className="map-layer-run__changed" role="status">
					<span aria-hidden="true" className="codicon codicon-warning" />
					<span className="map-layer-run__text">{CHANGED_AFTER_RUN}</span>
					{onUseNewFile && (
						<button className="map-chip" onClick={onUseNewFile} type="button">
							Use new file
						</button>
					)}
				</div>
			)}
		</div>
	)
}
