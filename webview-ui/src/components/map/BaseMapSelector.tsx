import React from "react"
import { BASE_MAP_STYLES, type BaseMapStyle, DEFAULT_BASEMAP_ID } from "./basemaps"
import { MAP_Z } from "./mapZ"

// The catalogue lives in basemaps.ts (pure data: zoom limits, extents, attribution). Re-exported so existing
// importers keep working.
export { BASE_MAP_STYLES, type BaseMapStyle }

interface BaseMapSelectorProps {
	currentStyle: string
	onStyleChange: (styleId: string) => void
	mapStyle?: "light" | "dark"
	/** True when the current basemap is one the user picked (not the hydrology default). */
	explicit?: boolean
	/** Clears the user's choice and returns to the hydrology default. */
	onResetToDefault?: () => void
}

/**
 * BasemapList — vertical list-style basemap picker, rendered inside the
 * MapToolRibbon panel area. Replaces the floating dropdown for a more
 * GIS-native UX (preview each basemap, group by provider, show attribution).
 */
export const BasemapList: React.FC<BaseMapSelectorProps> = ({
	currentStyle,
	onStyleChange,
	mapStyle = "dark",
	explicit = false,
	onResetToDefault,
}) => {
	const availableStyles = BASE_MAP_STYLES
	const selectedStyle = availableStyles.find((s) => s.id === currentStyle)
	const resetUseful = onResetToDefault && (explicit || currentStyle !== DEFAULT_BASEMAP_ID)

	const isDark = mapStyle === "dark"
	const fg = isDark ? "var(--vscode-foreground, #ddd)" : "var(--vscode-foreground, #222)"
	const subtle = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"
	const accent = "var(--vscode-button-background, #0e639c)"

	return (
		<div style={{ flex: 1, overflowY: "auto", padding: 4, minHeight: 0 }}>
			{availableStyles.map((style) => {
				const selected = style.id === currentStyle
				return (
					<button
						key={style.id}
						onClick={() => onStyleChange(style.id)}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 8,
							width: "100%",
							padding: "6px 8px",
							marginBottom: 2,
							background: selected ? "rgba(14,99,156,0.20)" : "transparent",
							color: fg,
							border: selected ? `1px solid ${accent}` : "1px solid transparent",
							borderRadius: 3,
							cursor: "pointer",
							textAlign: "left",
							fontSize: 12,
							fontFamily: "inherit",
							lineHeight: 1.3,
						}}
						title={style.attribution ?? style.name}
						type="button">
						<span
							aria-hidden="true"
							className={`codicon codicon-${selected ? "check" : "map"}`}
							style={{ flexShrink: 0, fontSize: 14, width: 18, textAlign: "center" }}
						/>
						<span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
							{style.name}
						</span>
					</button>
				)
			})}

			{(selectedStyle?.attribution || selectedStyle?.note) && (
				<div
					style={{
						padding: "8px 8px 4px",
						marginTop: 6,
						borderTop: `1px solid ${subtle}`,
						fontSize: 11,
						opacity: 0.8,
						lineHeight: 1.4,
					}}>
					{selectedStyle?.note && <div style={{ marginBottom: 4 }}>{selectedStyle.note}</div>}
					{selectedStyle?.attribution}
				</div>
			)}

			{onResetToDefault && (
				<div style={{ padding: "8px 8px 4px" }}>
					<button
						disabled={!resetUseful}
						onClick={onResetToDefault}
						style={{
							width: "100%",
							padding: "6px 8px",
							fontSize: 12,
							fontFamily: "inherit",
							color: fg,
							background: "transparent",
							border: `1px solid ${resetUseful ? accent : subtle}`,
							borderRadius: 3,
							cursor: resetUseful ? "pointer" : "default",
							opacity: resetUseful ? 1 : 0.6,
						}}
						title="Use the muted hydrology basemap and stop keeping a manual choice"
						type="button">
						Reset to hydrology default
					</button>
				</div>
			)}
		</div>
	)
}

/**
 * BaseMapSelector — legacy floating-dropdown variant. Kept for the in-chat
 * map tab where the ribbon is overkill. New surfaces should use BasemapList.
 */
export const BaseMapSelector: React.FC<BaseMapSelectorProps> = ({ currentStyle, onStyleChange, mapStyle = "dark" }) => {
	const availableStyles = BASE_MAP_STYLES
	const selected = availableStyles.find((s) => s.id === currentStyle)

	return (
		<div
			style={{
				position: "absolute",
				top: 10,
				right: 10,
				zIndex: MAP_Z.panel,
				background:
					mapStyle === "dark"
						? "var(--vscode-editor-background, rgba(30,30,30,0.95))"
						: "var(--vscode-editor-background, rgba(255,255,255,0.95))",
				color: "var(--vscode-foreground, inherit)",
				borderRadius: 4,
				boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
				border: `1px solid ${mapStyle === "dark" ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)"}`,
				fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
			}}>
			<select
				onChange={(e) => onStyleChange(e.target.value)}
				style={{
					padding: "6px 10px",
					fontSize: 12,
					border: "none",
					borderRadius: 4,
					backgroundColor: "transparent",
					color: "inherit",
					cursor: "pointer",
					outline: "none",
					minWidth: 200,
					fontFamily: "inherit",
				}}
				title={selected?.attribution ?? "Select base map"}
				value={currentStyle}>
				{availableStyles.map((style) => (
					<option key={style.id} value={style.id}>
						{style.name}
					</option>
				))}
			</select>
		</div>
	)
}

export default BaseMapSelector
