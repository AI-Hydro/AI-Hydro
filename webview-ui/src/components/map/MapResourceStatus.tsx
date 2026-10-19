import type { MapLayer } from "@shared/proto/cline/map"
import { useState } from "react"
import { MAP_Z } from "./mapZ"
import type { ResourceState } from "./useRasterResources"

interface StatusRow {
	id: string
	name: string
	status: string
	message: string
}

/**
 * Map resource notices, worded for what actually went wrong:
 *
 *   - imagery problems (tiles, rasters): alert + "Retry imagery" + the reminder that missing imagery is not
 *     evidence of missing environmental features;
 *   - renderer problems (WebGL / deck.gl): alert + "Reload map renderer", no imagery wording;
 *   - a few missing tiles: a quiet status note, never an alert (`tileNotes`);
 *   - the alert can be dismissed. Dismissal hides the banner for that exact set of problems and leaves a small
 *     "Map issues" button; the problems themselves (export gating, ribbon issue list) are unchanged.
 */
export function MapResourceStatus({
	layers,
	visibleLayerIds,
	rasterStates,
	tileErrors,
	tileNotes = {},
	sourceLabels = { basemap: "Basemap" },
	rendererError,
	onRetry,
	onReloadRenderer,
}: {
	layers: MapLayer[]
	visibleLayerIds: Set<string>
	rasterStates: Record<string, ResourceState>
	rendererError?: string | null
	tileErrors: Record<string, string>
	/** Sources with a few missing tiles: id ("basemap" or a layer id) -> sentence. */
	tileNotes?: Record<string, string>
	/** Display names for tile sources that are not layers (the basemap and its overlays). */
	sourceLabels?: Record<string, string>
	/** Re-request imagery (tile and raster failures). */
	onRetry: () => void
	/** Rebuild the deck.gl renderer. Falls back to `onRetry`, which also remounts it. */
	onReloadRenderer?: () => void
}) {
	const [dismissedKey, setDismissedKey] = useState<string | null>(null)

	const visibleLayers = layers.filter((layer) => visibleLayerIds.has(layer.id))
	const rows: StatusRow[] = visibleLayers.flatMap((layer) => {
		const state = rasterStates[layer.id]
		const error = tileErrors[layer.id]
		return error
			? [{ id: layer.id, name: layer.name, status: "error", message: error }]
			: state
				? [{ id: layer.id, name: layer.name, ...state }]
				: []
	})
	const layerIds = new Set(layers.map((layer) => layer.id))
	const sourceIds = Object.keys(sourceLabels)
	for (const id of [...sourceIds].reverse()) {
		if (tileErrors[id] && !layerIds.has(id)) {
			rows.unshift({ id: `__${id}__`, name: sourceLabels[id], status: "error", message: tileErrors[id] })
		}
	}

	const imageryErrors = rows.filter((row) => row.status === "error")
	const loading = rows.filter((row) => row.status !== "error")
	const notes = [
		...sourceIds.filter((id) => tileNotes[id] && !layerIds.has(id)).map((id) => ({ id: `__${id}__`, name: sourceLabels[id], message: tileNotes[id] })),
		...visibleLayers.filter((layer) => tileNotes[layer.id]).map((layer) => ({ id: layer.id, name: layer.name, message: tileNotes[layer.id] })),
	]

	const problemKey = JSON.stringify([rendererError ?? null, imageryErrors.map((row) => [row.id, row.message])])
	const hasProblem = Boolean(rendererError) || imageryErrors.length > 0
	if (!hasProblem && !loading.length && !notes.length) return null

	// Targets of at least 24 px (WCAG 2.2 target size).
	const button: React.CSSProperties = { minHeight: 24, minWidth: 24, padding: "2px 8px" }
	const frame: React.CSSProperties = {
		position: "absolute",
		bottom: 52,
		left: "50%",
		transform: "translateX(-50%)",
		zIndex: MAP_Z.toast,
		width: "max-content",
		maxWidth: "min(460px, calc(100% - 24px))",
		maxHeight: 220,
		overflow: "auto",
		padding: 10,
		background: "var(--vscode-editor-background)",
		color: "var(--vscode-foreground)",
		border: "1px solid var(--vscode-editorWarning-foreground)",
		borderRadius: 4,
	}

	if (hasProblem && dismissedKey === problemKey) {
		return (
			<div style={{ ...frame, padding: "4px 8px" }}>
				<button onClick={() => setDismissedKey(null)} style={button} title="Show the map problems that were dismissed" type="button">
					Map issues ({imageryErrors.length + (rendererError ? 1 : 0)})
				</button>
			</div>
		)
	}

	if (hasProblem) {
		return (
			<div role="alert" style={frame}>
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<strong style={{ flex: 1 }}>
						{rendererError && imageryErrors.length === 0 ? "Map renderer stopped" : "Map display incomplete"}
					</strong>
					<button aria-label="Dismiss map issues" onClick={() => setDismissedKey(problemKey)} style={button} type="button">
						Dismiss
					</button>
				</div>
				{rendererError && <div>Map renderer: {rendererError}</div>}
				{imageryErrors.map((row) => (
					<div key={row.id}>
						{row.name}: {row.message}
					</div>
				))}
				{imageryErrors.length > 0 && <div>Missing imagery is not evidence of missing environmental features.</div>}
				<div style={{ display: "flex", gap: 6, marginTop: 6 }}>
					{rendererError && (
						<button onClick={onReloadRenderer ?? onRetry} style={button} type="button">
							Reload map renderer
						</button>
					)}
					{imageryErrors.length > 0 && (
						<button onClick={onRetry} style={button} type="button">
							Retry imagery
						</button>
					)}
				</div>
			</div>
		)
	}

	return (
		<div role="status" style={frame}>
			{loading.length > 0 && <strong>Loading map imagery</strong>}
			{loading.map((row) => (
				<div key={row.id}>
					{row.name}: {row.message}
				</div>
			))}
			{notes.map((note) => (
				<div key={note.id}>
					{note.name}: {note.message}
				</div>
			))}
		</div>
	)
}
