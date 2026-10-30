import React, { useEffect, useRef, useState } from "react"
import type { MapAnnotation } from "./annotationStorage"
import { MAP_Z } from "./mapZ"
import { formatPinCoords, pinCoords } from "./pins"

export interface PinCardProps {
	pin: MapAnnotation
	mapStyle: "dark" | "light"
	/** Put the cursor in the name field (a pin just placed, or "Rename pin"). */
	focusName?: boolean
	onRename: (name: string) => void
	onNote: (notes: string) => void
	onAsk: () => void
	onDelineate: () => void
	onCopy: () => void
	onDelete: () => void
	onClose: () => void
}

/**
 * What a click on a pin opens. It shows what the user wrote (name, note), where the pin is and what they can do with
 * it. It never shows internals: no layer id, no colour field, no generic property table.
 */
const PinCard: React.FC<PinCardProps> = ({
	pin,
	mapStyle,
	focusName = false,
	onRename,
	onNote,
	onAsk,
	onDelineate,
	onCopy,
	onDelete,
	onClose,
}) => {
	const [name, setName] = useState(pin.name)
	const [note, setNote] = useState(pin.notes)
	const [copied, setCopied] = useState(false)
	const nameRef = useRef<HTMLInputElement>(null)
	const [lon, lat] = pinCoords(pin)

	// A different pin, or the same pin renamed from the Pins panel: show what is stored.
	useEffect(() => {
		setName(pin.name)
		setNote(pin.notes)
	}, [pin.id, pin.name, pin.notes])

	useEffect(() => {
		if (focusName) {
			nameRef.current?.focus()
			nameRef.current?.select()
		}
	}, [focusName, pin.id])

	const isDark = mapStyle === "dark"
	const bg = isDark ? "rgba(20,20,28,0.97)" : "rgba(252,252,252,0.97)"
	const fg = isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.88)"
	const bd = isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)"
	const muted = isDark ? "rgba(255,255,255,0.62)" : "rgba(0,0,0,0.62)"
	const accent = isDark ? "#7ec8ff" : "#0e639c"
	const danger = isDark ? "#f87171" : "#dc2626"
	const field = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)"

	const commitName = () => {
		const next = name.trim()
		if (!next) {
			setName(pin.name) // a pin always has a name
			return
		}
		if (next !== pin.name) {
			onRename(next)
		}
	}

	const action = (icon: string, label: string, onClick: () => void, color?: string): React.ReactNode => (
		<button
			onClick={onClick}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 5,
				minHeight: 26,
				padding: "2px 8px",
				fontSize: 12,
				background: "transparent",
				color: color ?? fg,
				border: `1px solid ${bd}`,
				borderRadius: 4,
				cursor: "pointer",
			}}
			type="button">
			<span aria-hidden="true" className={`codicon codicon-${icon}`} />
			{label}
		</button>
	)

	return (
		<div
			aria-label={`Pin: ${pin.name}`}
			data-testid="pin-card"
			onClick={(e) => e.stopPropagation()}
			onKeyDown={(e) => {
				// Escape inside a field first leaves the field; the next one closes the card.
				if (e.key === "Escape") {
					e.stopPropagation()
					if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") {
						;(e.target as HTMLElement).blur()
					} else {
						onClose()
					}
				}
			}}
			onMouseDown={(e) => e.stopPropagation()}
			role="dialog"
			style={{
				position: "absolute",
				left: 12,
				top: 12,
				zIndex: MAP_Z.panel,
				width: 280,
				maxWidth: "calc(100% - 24px)",
				boxSizing: "border-box",
				padding: 10,
				background: bg,
				color: fg,
				border: `1px solid ${bd}`,
				borderRadius: 8,
				boxShadow: "0 6px 20px rgba(0,0,0,0.40)",
				fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
				fontSize: 12,
				display: "flex",
				flexDirection: "column",
				gap: 8,
			}}>
			<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
				<span aria-hidden="true" className="codicon codicon-pin" style={{ color: pin.color }} />
				<input
					aria-label="Pin name"
					onBlur={commitName}
					onChange={(e) => setName(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault()
							commitName()
							;(e.target as HTMLInputElement).blur()
						} else if (e.key === "Escape") {
							setName(pin.name)
						}
					}}
					ref={nameRef}
					style={{
						flex: 1,
						minWidth: 0,
						minHeight: 24,
						boxSizing: "border-box",
						padding: "2px 6px",
						fontSize: 13,
						fontWeight: 600,
						color: fg,
						background: field,
						border: `1px solid ${bd}`,
						borderRadius: 4,
						fontFamily: "inherit",
					}}
					value={name}
				/>
				<button
					aria-label="Close pin card"
					onClick={onClose}
					style={{
						minWidth: 24,
						minHeight: 24,
						background: "transparent",
						color: muted,
						border: "none",
						cursor: "pointer",
					}}
					type="button">
					<span aria-hidden="true" className="codicon codicon-close" />
				</button>
			</div>

			<div style={{ color: muted, fontFamily: "monospace", fontSize: 11 }}>{formatPinCoords(lon, lat)}</div>

			<textarea
				aria-label="Pin note"
				onBlur={() => note !== pin.notes && onNote(note)}
				onChange={(e) => setNote(e.target.value)}
				placeholder="Add a note"
				rows={2}
				style={{
					width: "100%",
					boxSizing: "border-box",
					resize: "vertical",
					padding: "4px 6px",
					fontSize: 12,
					color: fg,
					background: field,
					border: `1px solid ${bd}`,
					borderRadius: 4,
					fontFamily: "inherit",
				}}
				value={note}
			/>

			<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
				{action("sparkle", "Ask AI-Hydro", onAsk, accent)}
				{action("symbol-field", "Delineate here", onDelineate)}
				{action(
					copied ? "check" : "copy",
					copied ? "Copied" : "Copy coordinates",
					() => {
						onCopy()
						setCopied(true)
						window.setTimeout(() => setCopied(false), 1200)
					},
					undefined,
				)}
				{action("trash", "Delete", onDelete, danger)}
			</div>
			<div style={{ color: muted, fontSize: 11 }}>Your note. Not a measurement.</div>
		</div>
	)
}

export default PinCard
