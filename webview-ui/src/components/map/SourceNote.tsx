import type { MapLayer } from "@shared/proto/cline/map"
import type React from "react"
import { useState } from "react"
import { PLATFORM_CONFIG } from "../../config/platform.config"
import { sourceNote } from "./sourceNoteText"

/**
 * One line in a layer's drawer about its file. A layer that follows nothing by itself (it has a run or another evidence
 * link) also gets `Use new file`, which asks once what it will cost before the host replaces the content.
 */
export const SourceNote: React.FC<{ layer: MapLayer }> = ({ layer }) => {
	const [asking, setAsking] = useState(false)
	const note = sourceNote(layer)
	if (!note) return null
	const choose = () => {
		setAsking(false)
		PLATFORM_CONFIG.postMessage({ type: "aihydro-map-use-new-file", layerId: layer.id })
	}
	return (
		<div className="map-layer-source-note" data-source-note={note.kind}>
			<div className="map-layer-hint" role={note.kind === "updated" ? undefined : "status"}>
				{note.text}
			</div>
			{note.useNewFile && !asking && (
				<div className="map-layer-drawer__actions">
					<button className="map-chip" onClick={() => setAsking(true)} type="button">
						<span aria-hidden="true" className="codicon codicon-file" />
						Use new file
					</button>
				</div>
			)}
			{note.useNewFile && asking && (
				<div aria-label="Use the new file" className="map-layers__confirm" role="alertdialog">
					<span>{note.useNewFile.question}</span>
					<button className="map-chip map-chip--danger" onClick={choose} type="button">
						Use new file
					</button>
					<button className="map-chip" onClick={() => setAsking(false)} type="button">
						Cancel
					</button>
				</div>
			)}
		</div>
	)
}
