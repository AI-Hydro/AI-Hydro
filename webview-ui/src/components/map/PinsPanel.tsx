import React, { useState } from "react"
import type { MapAnnotation } from "./annotationStorage"
import { type OverflowItem, OverflowMenu } from "./OverflowMenu"
import { formatPinCoords, pinCoords, pinLabel } from "./pins"

export interface PinsPanelProps {
	/** Only pins (points). Lines and areas are in the Draw panel. */
	pins: MapAnnotation[]
	selectedId: string | null
	/** The pin tool (P) is waiting for a click. */
	toolArmed: boolean
	mapStyle?: "dark" | "light"
	/** Pins carried over from before projects: the panel offers "Keep" or "Clear". */
	importedCount: number
	onToggleTool: () => void
	onSelect: (id: string) => void
	onZoomTo: (id: string) => void
	onRename: (id: string, name: string) => void
	onDelete: (id: string) => void
	onClearAll: () => void
	onKeepImported: () => void
	onClearImported: () => void
	onExport?: () => void
	onSeedFromLayer?: () => string
}

/**
 * The Pins rail panel: one row per pin (name and coordinates), and one "more" menu per row (zoom to, rename, delete) and
 * one for the panel (from layer, export, clear all with a confirm). Same row and menu rules as the Layers panel.
 */
const PinsPanel: React.FC<PinsPanelProps> = ({
	pins,
	selectedId,
	toolArmed,
	importedCount,
	onToggleTool,
	onSelect,
	onZoomTo,
	onRename,
	onDelete,
	onClearAll,
	onKeepImported,
	onClearImported,
	onExport,
	onSeedFromLayer,
}) => {
	const [editingId, setEditingId] = useState<string | null>(null)
	const [draft, setDraft] = useState("")
	const [confirmClear, setConfirmClear] = useState(false)
	const [confirmImported, setConfirmImported] = useState(false)
	const [seedMessage, setSeedMessage] = useState<string | null>(null)

	// The panel sits on the VS Code panel background, so it takes its colours from the theme (hc-light included), not
	// from the map style.
	const fg = "var(--vscode-foreground)"
	const border = "var(--vscode-panel-border, rgba(128,128,128,0.45))"
	const muted = "var(--vscode-descriptionForeground)"
	const field = "var(--vscode-input-background)"
	const rowBg = "var(--vscode-list-hoverBackground, rgba(128,128,128,0.12))"
	const selectedBg = "var(--vscode-list-activeSelectionBackground, rgba(14,99,156,0.3))"
	const danger = "var(--vscode-errorForeground, #f14c4c)"

	const startEdit = (pin: MapAnnotation) => {
		setEditingId(pin.id)
		setDraft(pin.name)
	}
	const finishEdit = (commit: boolean) => {
		if (editingId && commit && draft.trim()) {
			onRename(editingId, draft.trim())
		}
		setEditingId(null)
	}

	const textBtn = (icon: string, label: string, onClick: () => void, opts: { pressed?: boolean; color?: string } = {}) => (
		<button
			aria-pressed={opts.pressed}
			onClick={onClick}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 5,
				minHeight: 26,
				padding: "2px 8px",
				fontSize: 12,
				background: opts.pressed ? "var(--vscode-button-background, #0e639c)" : "transparent",
				color: opts.pressed ? "var(--vscode-button-foreground, #fff)" : (opts.color ?? fg),
				border: `1px solid ${border}`,
				borderRadius: 4,
				cursor: "pointer",
			}}
			type="button">
			<span aria-hidden="true" className={`codicon codicon-${icon}`} />
			{label}
		</button>
	)

	const panelItems: OverflowItem[] = [
		...(onSeedFromLayer
			? [
					{
						key: "seed",
						label: "Add pins from a layer",
						icon: "layers",
						onSelect: () => setSeedMessage(onSeedFromLayer()),
					} as OverflowItem,
				]
			: []),
		{
			key: "export",
			label: "Export pins",
			icon: "export",
			disabledReason: !onExport || pins.length === 0 ? "No pins to export" : undefined,
			onSelect: () => onExport?.(),
		},
		{ key: "d1", divider: true },
		{
			key: "clear",
			label: "Clear all pins…",
			icon: "clear-all",
			danger: true,
			disabledReason: pins.length === 0 ? "No pins" : undefined,
			onSelect: () => setConfirmClear(true),
		},
	]

	const rowItems = (pin: MapAnnotation): OverflowItem[] => [
		{ key: "zoom", label: "Zoom to pin", icon: "target", onSelect: () => onZoomTo(pin.id) },
		{ key: "rename", label: "Rename", icon: "edit", onSelect: () => startEdit(pin) },
		{ key: "d1", divider: true },
		{ key: "delete", label: "Delete pin", icon: "trash", danger: true, onSelect: () => onDelete(pin.id) },
	]

	return (
		<div data-testid="pins-panel" style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12, color: fg }}>
			<div style={{ display: "flex", gap: 6, alignItems: "center" }}>
				{textBtn("add", "Add pin", onToggleTool, { pressed: toolArmed })}
				<span style={{ flex: 1 }} />
				<OverflowMenu items={panelItems} label="Pins panel actions" />
			</div>
			<div style={{ color: muted, fontSize: 11 }}>
				{toolArmed
					? "Click the map to place a pin. Esc to stop."
					: "Press P, then click the map. Or right-click the map and choose Add pin."}
			</div>
			{seedMessage && (
				<div role="status" style={{ color: muted, fontSize: 11 }}>
					{seedMessage}
				</div>
			)}

			{importedCount > 0 && (
				<div
					role="status"
					style={{
						padding: 8,
						border: `1px solid ${border}`,
						borderRadius: 6,
						background: rowBg,
						display: "flex",
						flexDirection: "column",
						gap: 6,
					}}>
					<div>
						{importedCount} {importedCount === 1 ? "pin" : "pins"} from before projects{" "}
						{importedCount === 1 ? "was" : "were"} moved into this project.
					</div>
					{confirmImported ? (
						<div
							aria-label="Clear imported pins"
							role="alertdialog"
							style={{ display: "flex", flexDirection: "column", gap: 6 }}>
							<div>
								Clear {importedCount === 1 ? "this pin" : `these ${importedCount} pins`}? They were your only copy
								from before projects. Undo works until you close the map.
							</div>
							<div style={{ display: "flex", gap: 6 }}>
								{textBtn("trash", "Yes, clear", () => {
									setConfirmImported(false)
									onClearImported()
								})}
								{textBtn("close", "Cancel", () => setConfirmImported(false))}
							</div>
						</div>
					) : (
						<div style={{ display: "flex", gap: 6 }}>
							{textBtn("check", "Keep", onKeepImported)}
							{textBtn("trash", "Clear them", () => setConfirmImported(true))}
						</div>
					)}
				</div>
			)}

			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
				<h3 style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>
					Pins <span style={{ color: muted, fontWeight: 400 }}>({pins.length})</span>
				</h3>
			</div>

			{confirmClear && (
				<div
					aria-label="Clear all pins"
					role="alertdialog"
					style={{
						padding: 8,
						border: `1px solid ${danger}`,
						borderRadius: 6,
						display: "flex",
						flexDirection: "column",
						gap: 6,
					}}>
					<div>Clear all {pins.length} pins? You can undo this right after.</div>
					<div style={{ display: "flex", gap: 6 }}>
						{textBtn(
							"trash",
							"Clear all",
							() => {
								setConfirmClear(false)
								onClearAll()
							},
							{ color: danger },
						)}
						{textBtn("close", "Cancel", () => setConfirmClear(false))}
					</div>
				</div>
			)}

			{pins.length === 0 ? (
				<div style={{ color: muted, padding: "6px 0" }}>No pins yet.</div>
			) : (
				<ul
					aria-label="Pins"
					style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
					{pins.map((pin) => {
						const [lon, lat] = pinCoords(pin)
						const selected = pin.id === selectedId
						return (
							<li
								key={pin.id}
								style={{
									display: "flex",
									alignItems: "center",
									gap: 4,
									padding: "2px 4px 2px 8px",
									borderRadius: 6,
									background: selected ? selectedBg : rowBg,
									border: `1px solid ${selected ? "var(--vscode-focusBorder, #0e639c)" : "transparent"}`,
								}}>
								<span aria-hidden="true" className="codicon codicon-pin" style={{ color: pin.color }} />
								{editingId === pin.id ? (
									<input
										aria-label="Pin name"
										autoFocus
										onBlur={() => finishEdit(true)}
										onChange={(e) => setDraft(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter") finishEdit(true)
											else if (e.key === "Escape") {
												e.stopPropagation()
												finishEdit(false)
											}
										}}
										style={{
											flex: 1,
											minWidth: 0,
											minHeight: 24,
											boxSizing: "border-box",
											padding: "2px 6px",
											fontSize: 12,
											color: fg,
											background: field,
											border: `1px solid ${border}`,
											borderRadius: 4,
											fontFamily: "inherit",
										}}
										value={draft}
									/>
								) : (
									<button
										aria-label={`Open pin ${pinLabel(pin)}`}
										aria-pressed={selected}
										onClick={() => onSelect(pin.id)}
										style={{
											flex: 1,
											minWidth: 0,
											minHeight: 30,
											display: "flex",
											flexDirection: "column",
											alignItems: "flex-start",
											justifyContent: "center",
											padding: "0 2px",
											background: "transparent",
											color: fg,
											border: "none",
											cursor: "pointer",
											textAlign: "left",
										}}
										type="button">
										<span
											style={{
												maxWidth: "100%",
												overflow: "hidden",
												textOverflow: "ellipsis",
												whiteSpace: "nowrap",
												fontWeight: 600,
											}}>
											{pinLabel(pin)}
										</span>
										<span style={{ color: selected ? fg : muted, fontFamily: "monospace", fontSize: 11 }}>
											{formatPinCoords(lon, lat)}
										</span>
									</button>
								)}
								<OverflowMenu items={rowItems(pin)} label={`Actions for ${pinLabel(pin)}`} />
							</li>
						)
					})}
				</ul>
			)}
		</div>
	)
}

export default PinsPanel
