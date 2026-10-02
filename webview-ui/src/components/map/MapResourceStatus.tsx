import type { MapLayer } from "@shared/proto/cline/map"
import type { ResourceState } from "./useRasterResources"

export function MapResourceStatus({
	layers,
	visibleLayerIds,
	rasterStates,
	tileErrors,
	rendererError,
	onRetry,
}: {
	layers: MapLayer[]
	visibleLayerIds: Set<string>
	rasterStates: Record<string, ResourceState>
	rendererError?: string | null
	tileErrors: Record<string, string>
	onRetry: () => void
}) {
	const rows = layers
		.filter((layer) => visibleLayerIds.has(layer.id))
		.flatMap((layer) => {
			const state = rasterStates[layer.id]
			const error = tileErrors[layer.id]
			return error
				? [{ id: layer.id, name: layer.name, status: "error", message: error }]
				: state
					? [{ id: layer.id, name: layer.name, ...state }]
					: []
		})
	if (tileErrors.basemap) rows.unshift({ id: "__basemap__", name: "Basemap", status: "error", message: tileErrors.basemap })
	if (rendererError) rows.unshift({ id: "__renderer__", name: "Map renderer", status: "error", message: rendererError })
	if (!rows.length) return null
	const failed = rows.some((row) => row.status === "error")
	return (
		<div
			role={failed ? "alert" : "status"}
			style={{
				position: "absolute",
				bottom: 52,
				left: 12,
				zIndex: 50,
				maxWidth: 460,
				maxHeight: 220,
				overflow: "auto",
				padding: 10,
				background: "var(--vscode-editor-background)",
				color: "var(--vscode-foreground)",
				border: "1px solid var(--vscode-editorWarning-foreground)",
				borderRadius: 4,
			}}>
			<strong>{failed ? "Map display incomplete" : "Loading map imagery"}</strong>
			{rows.map((row) => (
				<div key={row.id}>
					{row.name}: {row.message}
				</div>
			))}
			{failed && (
				<>
					<div>Missing imagery is not evidence of missing environmental features.</div>
					<button onClick={onRetry}>Retry imagery</button>
				</>
			)}
		</div>
	)
}
