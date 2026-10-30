/**
 * LayerRow: one layer in the Layers list, on one line.
 *
 *   [grip] [eye] [swatch] name .................. [warning] [note] [duplicate] [more]
 *
 * Everything else lives behind the "more" menu (zoom to, rename, style, save, export, copy tool and run id, move,
 * remove) or in the drawer a selected row opens (opacity, style, attributes, details). The row never shows a status
 * chip: a real warning is one warning icon with its text as tooltip and as the accessible name; a capability note
 * ("Limited layer") is one quiet info icon, or a single line on the group when every layer in it has the same note.
 *
 * Presentational only: LayerPanel owns the state and builds the menu.
 */

import type { MapLayer } from "@shared/proto/cline/map"
import React from "react"
import { colorSwatch } from "./layerPanelParts"
import { type OverflowItem, OverflowMenu } from "./OverflowMenu"

export interface LayerRowProps {
	layer: MapLayer
	displayName: string
	visible: boolean
	selected: boolean
	/** Real warnings; always shown. */
	warnings: string[]
	/** A quiet capability note, shown on the row unless the group states it once. */
	note?: string
	duplicate: boolean
	menuItems: OverflowItem[]
	renaming: boolean
	renameDraft: string
	onRenameDraft: (value: string) => void
	onRenameCommit: () => void
	onRenameCancel: () => void
	onStartRename: () => void
	onToggleVisible: () => void
	onSelect: () => void
	/** Open the drawer on the Details view (the warning and note icons do this). */
	onShowDetails: () => void
	/** Drag reorder (same group only). */
	dragging: boolean
	dropTarget: "above" | "below" | null
	onDragStart: (e: React.DragEvent) => void
	onDragOver: (e: React.DragEvent) => void
	onDrop: (e: React.DragEvent) => void
	onDragEnd: () => void
	children?: React.ReactNode
}

/** The legend key: fill colour for polygons, a stroke for lines, a dot for points, a ramp for rasters. */
const Swatch: React.FC<{ layer: MapLayer }> = ({ layer }) => {
	const fill = colorSwatch(layer)
	const type = (layer.layerType ?? "").toLowerCase()
	const isRamp = type === "raster" || type === "gee_tile"
	const shape = isRamp ? "ramp" : type === "line" ? "line" : type === "point" ? "point" : "area"
	return (
		<span
			aria-hidden="true"
			className={`map-layer-swatch map-layer-swatch--${shape}`}
			style={{ background: fill, borderColor: layer.style?.strokeColor || layer.style?.color || undefined }}
		/>
	)
}

export const LayerRow: React.FC<LayerRowProps> = ({
	layer,
	displayName,
	visible,
	selected,
	warnings,
	note,
	duplicate,
	menuItems,
	renaming,
	renameDraft,
	onRenameDraft,
	onRenameCommit,
	onRenameCancel,
	onStartRename,
	onToggleVisible,
	onSelect,
	onShowDetails,
	dragging,
	dropTarget,
	onDragStart,
	onDragOver,
	onDrop,
	onDragEnd,
	children,
}) => {
	return (
		<li
			className="map-layer-row"
			data-dragging={dragging || undefined}
			data-drop={dropTarget ?? undefined}
			data-hidden={!visible || undefined}
			data-layer-id={layer.id}
			data-selected={selected || undefined}>
			<div
				className="map-layer-row__line"
				draggable={!renaming}
				onDragEnd={onDragEnd}
				onDragOver={onDragOver}
				onDragStart={onDragStart}
				onDrop={onDrop}>
				<span aria-hidden="true" className="codicon codicon-gripper map-layer-grip" title="Drag to reorder" />
				<button
					aria-label={`${visible ? "Hide" : "Show"} ${displayName}`}
					aria-pressed={visible}
					className="map-layer-eye"
					onClick={onToggleVisible}
					title={visible ? "Hide layer" : "Show layer"}
					type="button">
					<span aria-hidden="true" className={`codicon codicon-${visible ? "eye" : "eye-closed"}`} />
				</button>
				<Swatch layer={layer} />
				{renaming ? (
					<input
						aria-label="Layer display name"
						autoFocus
						className="map-layer-rename"
						onBlur={onRenameCommit}
						onChange={(e) => onRenameDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") onRenameCommit()
							if (e.key === "Escape") onRenameCancel()
						}}
						type="text"
						value={renameDraft}
					/>
				) : (
					<button
						aria-expanded={selected}
						className="map-layer-name"
						onClick={onSelect}
						onDoubleClick={onStartRename}
						title={`${displayName}\nClick for opacity and style. Double-click to rename.`}
						type="button">
						<span>{displayName}</span>
					</button>
				)}
				{warnings.length > 0 && (
					<button
						aria-label={`Warning for ${displayName}: ${warnings.join(" ")}`}
						className="map-layer-flag map-layer-flag--warn"
						onClick={onShowDetails}
						title={warnings.join("\n")}
						type="button">
						<span aria-hidden="true" className="codicon codicon-warning" />
					</button>
				)}
				{note && (
					<button
						aria-label={`Note for ${displayName}: ${note}`}
						className="map-layer-flag"
						onClick={onShowDetails}
						title={note}
						type="button">
						<span aria-hidden="true" className="codicon codicon-info" />
					</button>
				)}
				{duplicate && (
					<span
						aria-label="Duplicate: the same tool run and source is on the map more than once"
						className="map-layer-flag map-layer-flag--static"
						role="img"
						title="Duplicate: the same tool run and source is on the map more than once">
						<span aria-hidden="true" className="codicon codicon-files" />
					</span>
				)}
				<OverflowMenu items={menuItems} label={`Actions for ${displayName}`} />
			</div>
			{children}
		</li>
	)
}
