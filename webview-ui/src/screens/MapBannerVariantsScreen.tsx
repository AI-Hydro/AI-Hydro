/** Map resource-notice variants for the UI harness (dev-only): the real MapResourceStatus in each state. */
import type { MapLayer } from "@shared/proto/cline/map"
import { MapResourceStatus } from "../components/map/MapResourceStatus"

const layers: MapLayer[] = []

const Variant = ({ title, children }: { title: string; children: React.ReactNode }) => (
	<section aria-label={title} style={{ padding: "8px 12px" }}>
		<h2 style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 600 }}>{title}</h2>
		<div
			style={{
				position: "relative",
				height: 250,
				overflow: "hidden",
				border: "1px solid var(--vscode-panel-border, rgba(128,128,128,0.4))",
				background: "var(--vscode-editor-background)",
			}}>
			{children}
		</div>
	</section>
)

const common = { layers, visibleLayerIds: new Set<string>(), rasterStates: {}, onRetry: () => {}, onReloadRenderer: () => {} }
const RENDERER = "initialization of ScatterplotLayer({id: '__annotations-overlay-points-circle'}): deck.gl: assertion failed."

export function MapBannerVariantsScreen() {
	return (
		<div style={{ height: "100%", overflow: "auto" }}>
			<Variant title="Imagery failed: alert with Retry imagery">
				<MapResourceStatus {...common} tileErrors={{ basemap: "Tile request failed (HTTP 403)" }} />
			</Variant>
			<Variant title="Renderer stopped: alert with Reload map renderer">
				<MapResourceStatus {...common} rendererError={RENDERER} tileErrors={{}} />
			</Variant>
			<Variant title="Imagery and renderer both failed">
				<MapResourceStatus
					{...common}
					rendererError={RENDERER}
					tileErrors={{ basemap: "Tile request failed (HTTP 403)" }}
				/>
			</Variant>
			<Variant title="A few tiles missing: quiet status note, not an alert">
				<MapResourceStatus
					{...common}
					tileErrors={{}}
					tileNotes={{ basemap: "2 tiles unavailable (2 with no coverage at that location)" }}
				/>
			</Variant>
		</div>
	)
}
