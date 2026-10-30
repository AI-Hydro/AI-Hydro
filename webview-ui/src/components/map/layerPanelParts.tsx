/**
 * Pieces of the Layers panel that describe one layer: metadata summaries, the swatch, the attribute table and the
 * details inspector. Split from LayerPanel.tsx so the list, the row and the details can each stay small.
 */

import { layerRetrievedAt, layerRunId, layerTool, NO_RUN_RECORD } from "@shared/map/provenanceEnvelope"
import type { MapLayer } from "@shared/proto/cline/map"
import React, { useMemo, useState } from "react"
import { type LayerIntelligence, layerResearchDetails, warningText } from "./layerIntelligence"
import { geeDisplayLines } from "./mapLayerAdapters"
import { MAP_Z } from "./mapZ"

export const HIDDEN_KEYS = new Set([
	"__operation",
	"source",
	"path",
	"lastModified",
	"originalFormat",
	"formatIcon",
	"raster_data_url",
	"raster_bounds",
	"raster_opacity",
	"raster_path",
	"raster_colormap",
	"raster_cached",
	"gee_tile_url_template",
	"gee_remote_tile_url_template",
	"addedAt",
	"source_uri",
	"source_path",
	"source_display_path",
	"source_format",
	"source_mtime_ms",
	"source_size_bytes",
	"source_loaded_at_utc",
	"source_status",
	"source_remote_url",
	"source_derived_from",
	"converted_artifact_path",
	"conversion",
	"display_geojson_path",
	"display_mode",
	"full_geojson_embedded",
	"original_feature_count",
	"preview_feature_count",
	"preview_coord_count",
	"preview_bytes",
])

export const niceMetadata = (layer: MapLayer): Array<[string, string]> => {
	const out: Array<[string, string]> = []
	const meta = layer.metadata ?? {}
	if (layer.layerType !== "raster" && layer.geojson) {
		try {
			const p = JSON.parse(layer.geojson)
			if (p?.type === "FeatureCollection" && Array.isArray(p.features)) {
				out.push(["features", String(p.features.length)])
			}
		} catch {
			/* ignore */
		}
	}
	const PRIORITY = [
		"format",
		"crs",
		"reprojected",
		"units",
		"variable",
		"gee_dataset_id",
		"gee_start_date",
		"gee_end_date",
		"tool",
		"_run_id",
		"rows",
	]
	for (const k of PRIORITY) {
		if (meta[k]) {
			out.push([k, meta[k]])
		}
	}
	if (layer.layerType === "gee_tile") {
		for (const [k, v] of geeDisplayLines(layer)) {
			if (!out.some(([key]) => key === k)) {
				out.push([k, v])
			}
		}
	}
	return out
}

export const allMetadata = (layer: MapLayer): Array<[string, string]> =>
	Object.entries(layer.metadata ?? {}).filter(([k]) => !HIDDEN_KEYS.has(k) && !k.startsWith("__"))

export const colorSwatch = (layer: MapLayer): string => {
	if (layer.layerType === "gee_tile") {
		return "linear-gradient(to right, #081d58, #225ea8, #41b6c4, #a1dab4, #ffffcc)"
	}
	if (layer.layerType === "raster") {
		const cmap = layer.metadata?.raster_colormap ?? "viridis"
		const gradients: Record<string, string> = {
			viridis: "linear-gradient(to right, #440154, #31688e, #35b779, #fde725)",
			viridis_r: "linear-gradient(to right, #fde725, #35b779, #31688e, #440154)",
			YlOrRd: "linear-gradient(to right, #ffffb2, #fecc5c, #fd8d3c, #e31a1c)",
			Blues: "linear-gradient(to right, #f7fbff, #6baed6, #2171b5, #084594)",
			RdYlGn: "linear-gradient(to right, #d73027, #fee08b, #1a9850)",
			plasma: "linear-gradient(to right, #0d0887, #cc4778, #f0f921)",
			magma: "linear-gradient(to right, #000004, #b73779, #fcfdbf)",
			cividis: "linear-gradient(to right, #00224e, #7c7b78, #fde737)",
		}
		return gradients[cmap] ?? "linear-gradient(to right, #440154, #fde725)"
	}
	return layer.style?.fillColor || layer.style?.color || "#0066CC"
}

export const statusColors = (dataState: LayerIntelligence["dataState"]) => {
	switch (dataState) {
		case "analysis_ready_raster":
			return { bg: "rgba(43, 183, 117, 0.14)", fg: "#6ee7a8", bd: "rgba(43, 183, 117, 0.32)" }
		case "visual_preview_raster":
			return { bg: "rgba(255, 190, 80, 0.14)", fg: "#ffc857", bd: "rgba(255, 190, 80, 0.34)" }
		case "remote_raster":
			return { bg: "rgba(93, 173, 226, 0.14)", fg: "#7cc7ff", bd: "rgba(93, 173, 226, 0.32)" }
		case "reference_vector":
			return { bg: "rgba(52, 211, 153, 0.12)", fg: "#8ee8d1", bd: "rgba(52, 211, 153, 0.28)" }
		case "analysis_output":
			return { bg: "rgba(147, 197, 253, 0.12)", fg: "#a9d0ff", bd: "rgba(147, 197, 253, 0.28)" }
		default:
			return { bg: "rgba(255,255,255,0.08)", fg: "inherit", bd: "rgba(255,255,255,0.16)" }
	}
}

export const AttributeTable: React.FC<{ layer: MapLayer; border: string; fg: string }> = ({ layer, border, fg }) => {
	const [page, setPage] = useState(0)
	const PAGE_SIZE = 10

	const { features, headers } = useMemo(() => {
		try {
			const parsed = JSON.parse(layer.geojson)
			const feats = parsed?.type === "FeatureCollection" ? parsed.features : parsed?.type === "Feature" ? [parsed] : []
			const keys = new Set<string>()
			for (const f of feats.slice(0, 100)) {
				for (const k of Object.keys(f.properties ?? {})) {
					if (!k.startsWith("_")) {
						keys.add(k)
					}
				}
			}
			return { features: feats, headers: Array.from(keys).slice(0, 12) }
		} catch {
			return { features: [], headers: [] }
		}
	}, [layer.geojson])

	const pageFeats = features.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
	const totalPages = Math.ceil(features.length / PAGE_SIZE)

	if (features.length === 0 || headers.length === 0) {
		return (
			<div
				style={{
					marginTop: 8,
					padding: "6px 8px",
					fontSize: 11,
					opacity: 0.65,
					borderTop: `1px dashed ${border}`,
					color: fg,
				}}>
				{features.length === 0 ? "No features in this layer." : "Features have no attribute columns."}
			</div>
		)
	}

	const exportCsv = () => {
		try {
			const allKeys = new Set<string>()
			for (const f of features) {
				for (const k of Object.keys(f.properties ?? {})) {
					if (!k.startsWith("_")) {
						allKeys.add(k)
					}
				}
			}
			const cols = Array.from(allKeys)
			const escape = (v: unknown) => {
				const s = String(v ?? "")
				return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s
			}
			const rows = [
				cols.map(escape).join(","),
				...features.map((f: any) => cols.map((k) => escape(f.properties?.[k] ?? "")).join(",")),
			]
			const blob = new Blob([rows.join("\n")], { type: "text/csv" })
			const url = URL.createObjectURL(blob)
			const a = document.createElement("a")
			a.href = url
			a.download = `${layer.name ?? "layer"}_attributes.csv`
			a.click()
			URL.revokeObjectURL(url)
		} catch {
			/* ignore */
		}
	}

	return (
		<div
			style={{
				marginTop: 8,
				overflow: "auto",
				maxHeight: 220,
				fontSize: 11,
				fontFamily: "var(--vscode-editor-font-family, ui-monospace, monospace)",
				borderTop: `1px dashed ${border}`,
			}}>
			{/* Toolbar */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					padding: "3px 4px 3px 0",
					position: "sticky",
					top: 0,
					background: "var(--vscode-sideBar-background, #1e1e1e)",
					zIndex: MAP_Z.local,
					borderBottom: `1px solid ${border}`,
				}}>
				<span style={{ flex: 1, opacity: 0.6 }}>
					{features.length} feature{features.length === 1 ? "" : "s"} · {headers.length} cols
				</span>
				<button
					onClick={exportCsv}
					style={{
						fontSize: 11,
						padding: "1px 6px",
						background: "transparent",
						color: fg,
						border: `1px solid ${border}`,
						borderRadius: 3,
						cursor: "pointer",
						whiteSpace: "nowrap",
					}}
					title={`Download all ${features.length} rows as CSV`}
					type="button">
					<span aria-hidden="true" className="codicon codicon-desktop-download" /> CSV
				</button>
			</div>
			<table style={{ width: "100%", borderCollapse: "collapse" }}>
				<thead>
					<tr style={{ background: "rgba(255,255,255,0.05)" }}>
						{headers.map((h) => (
							<th
								key={h}
								style={{
									padding: "2px 5px",
									textAlign: "left",
									opacity: 0.75,
									borderBottom: `1px solid ${border}`,
									whiteSpace: "nowrap",
								}}>
								{h}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{pageFeats.map((f: any, i: number) => (
						<tr key={i} style={{ borderBottom: `1px solid ${border}` }}>
							{headers.map((h) => (
								<td
									key={h}
									style={{
										padding: "2px 5px",
										maxWidth: 120,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
										color: fg,
									}}
									title={String(f.properties?.[h] ?? "")}>
									{String(f.properties?.[h] ?? "")}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
			{totalPages > 1 && (
				<div style={{ display: "flex", gap: 6, justifyContent: "center", padding: 4, opacity: 0.7 }}>
					<button
						disabled={page === 0}
						onClick={() => setPage((p) => Math.max(0, p - 1))}
						style={{
							fontSize: 11,
							cursor: "pointer",
							background: "transparent",
							border: "none",
							color: fg,
							minHeight: 24,
							minWidth: 48,
						}}>
						‹ Prev
					</button>
					<span style={{ fontSize: 11 }}>
						{page + 1} / {totalPages} ({features.length} features)
					</span>
					<button
						disabled={page === totalPages - 1}
						onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
						style={{
							fontSize: 11,
							cursor: "pointer",
							background: "transparent",
							border: "none",
							color: fg,
							minHeight: 24,
							minWidth: 48,
						}}>
						Next ›
					</button>
				</div>
			)}
		</div>
	)
}

export const LayerInspector: React.FC<{
	layer: MapLayer
	intelligence: LayerIntelligence
	niceMeta: Array<[string, string]>
	border: string
	fg: string
	/** Called after a value is copied, with what was copied ("tool name", "run ID"). */
	onCopied?: (what: string) => void
}> = ({ layer, intelligence, niceMeta, border, fg, onCopied }) => {
	const [tab, setTab] = useState<"overview" | "data" | "provenance">("overview")
	const meta = layer.metadata ?? {}
	const all = allMetadata(layer)
	const statusTone = statusColors(intelligence.dataState)
	const rasterRange =
		meta.min || meta.max ? `${meta.min ?? "?"} – ${meta.max ?? "?"}${meta.units ? ` ${meta.units}` : ""}` : undefined
	const resolution = meta.resolution || meta.pixel_size || meta.cell_size || meta.raster_resolution

	return (
		<div
			style={{
				marginTop: 8,
				border: `1px solid ${border}`,
				borderRadius: 5,
				overflow: "hidden",
				background: "rgba(0,0,0,0.10)",
			}}>
			<div style={{ display: "flex", gap: 2, padding: 4, borderBottom: `1px solid ${border}` }}>
				{[
					["overview", "Overview"],
					["data", "Data"],
					["provenance", "Provenance"],
				].map(([key, label]) => (
					<button
						key={key}
						onClick={() => setTab(key as typeof tab)}
						style={{
							padding: "3px 8px",
							minHeight: 24,
							fontSize: 11,
							border: `1px solid ${tab === key ? statusTone.bd : "transparent"}`,
							borderRadius: 3,
							background: tab === key ? statusTone.bg : "transparent",
							color: fg,
							cursor: "pointer",
						}}
						type="button">
						{label}
					</button>
				))}
			</div>
			<div style={{ padding: 8, fontSize: 11, lineHeight: 1.45 }}>
				{tab === "overview" && (
					<>
						<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
							<strong style={{ fontSize: 12 }}>{layer.name || layer.id}</strong>
							<span
								style={{
									fontSize: 11,
									padding: "1px 6px",
									borderRadius: 999,
									background: statusTone.bg,
									border: `1px solid ${statusTone.bd}`,
									color: statusTone.fg,
								}}>
								{intelligence.statusLabel}
							</span>
						</div>
						<div style={{ opacity: 0.78, marginBottom: 8 }}>{intelligence.statusDetail}</div>
						<InspectorGrid
							border={border}
							rows={[
								["Type", intelligence.typeLabel],
								["Source", intelligence.sourceLabel],
								...(rasterRange ? ([["Value range", rasterRange]] as Array<[string, string]>) : []),
								...(resolution ? ([["Resolution", resolution]] as Array<[string, string]>) : []),
								...niceMeta.slice(0, 5),
							]}
						/>
						{intelligence.warnings.length > 0 && (
							<div
								style={{
									marginTop: 8,
									padding: "5px 7px",
									borderRadius: 4,
									background: "rgba(255, 190, 80, 0.10)",
									color: "var(--vscode-editorWarning-foreground, #cca700)",
								}}>
								{intelligence.warnings.map(warningText).join(" · ")}
							</div>
						)}
					</>
				)}
				{tab === "data" && (
					<InspectorGrid
						border={border}
						rows={[
							["Capabilities", Array.from(intelligence.capabilities).join(", ")],
							["Layer state", intelligence.dataState.replace(/_/g, " ")],
							[
								"Feature/raster info",
								niceMeta.length > 0 ? niceMeta.map(([k, v]) => `${k}: ${v}`).join("; ") : "No summary available",
							],
						]}
					/>
				)}
				{tab === "provenance" && (
					<InspectorGrid
						border={border}
						copyable={{
							"MCP tool": layerTool(meta) ? "tool name" : undefined,
							"Run ID": layerRunId(meta) ? "run ID" : undefined,
						}}
						onCopied={onCopied}
						rows={[
							["Source", intelligence.sourceLabel],
							...layerResearchDetails(layer),
							[
								"Source file",
								meta.source_display_path ?? meta.source_path ?? meta.path ?? "No local source path recorded",
							],
							["Source format", meta.source_format ?? meta.format ?? "Unknown"],
							["Converted artifact", meta.converted_artifact_path ?? "Not a converted vector layer"],
							["Provenance", intelligence.provenancePath ?? "No provenance record linked"],
							["Citation", intelligence.citation ?? "No citation recorded"],
							["License", intelligence.license ?? "No license recorded"],
							["Path", meta.path ?? meta.raster_source_path ?? meta.raster_path ?? "No local source path recorded"],
							["MCP tool", layerTool(meta) ?? "Not created by a tool"],
							["Run ID", layerRunId(meta) ?? NO_RUN_RECORD],
							["Agent step", meta.agent_step ?? "—"],
							["Computed at", layerRetrievedAt(meta) ?? "—"],
							["Time range", meta.time_start ? `${meta.time_start} – ${meta.time_end ?? "present"}` : "—"],
							["Linked claim", meta.claim_id ?? "—"],
							["Metadata fields", String(all.length)],
						]}
					/>
				)}
			</div>
		</div>
	)
}

export const InspectorGrid: React.FC<{
	rows: Array<[string, string]>
	border: string
	/** Row keys that get a copy button, mapped to what they hold ("run ID"); undefined means not copyable. */
	copyable?: Record<string, string | undefined>
	onCopied?: (what: string) => void
}> = ({ rows, border, copyable, onCopied }) => (
	<div
		style={{
			display: "grid",
			gridTemplateColumns: "minmax(78px, auto) 1fr",
			gap: "3px 8px",
			wordBreak: "break-word",
		}}>
		{rows
			.filter(([, value]) => value !== "")
			.map(([key, value]) => {
				const what = copyable?.[key]
				return (
					<React.Fragment key={`${key}-${value}`}>
						<span style={{ opacity: 0.75 }}>{key}</span>
						<span
							style={{
								borderBottom: `1px solid ${border}`,
								paddingBottom: 2,
								display: "flex",
								gap: 4,
								alignItems: "flex-start",
							}}>
							<span style={{ flex: 1, minWidth: 0 }}>{value}</span>
							{what && (
								<button
									aria-label={`Copy ${what}`}
									className="map-overflow-trigger"
									onClick={() => {
										void navigator.clipboard?.writeText(value)
										onCopied?.(what)
									}}
									title={`Copy ${what}`}
									type="button">
									<span aria-hidden="true" className="codicon codicon-copy" />
								</button>
							)}
						</span>
					</React.Fragment>
				)
			})}
	</div>
)
