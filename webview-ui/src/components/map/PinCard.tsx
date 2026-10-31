import React, { useEffect, useRef, useState } from "react"
import type { MapAnnotation } from "./annotationStorage"
import { actionLabel, MAP_ACTIONS } from "./mapActions"
import { MAP_Z } from "./mapZ"
import { type PinSaveStatus, pinSavePhase } from "./pinSaveStatus"
import { formatPinCoords, pinCoords } from "./pins"

export interface PinCardProps {
	pin: MapAnnotation
	mapStyle: "dark" | "light"
	/** Put the cursor in the name field (a pin just placed, or "Rename pin"). */
	focusName?: boolean
	/**
	 * Save the name and note together. Returns where the save went: the host save number, "local" when it could not be
	 * sent yet (the project is not known), or null when nothing changed.
	 */
	onSave: (patch: { id: string; name: string; notes: string }) => number | "local" | null
	/** Send the current pins to the host again after a failed save. */
	onRetry: () => number | "local"
	/** What the host has acknowledged so far. "Saved" is shown only when it covers this card's last save. */
	saveStatus: PinSaveStatus
	onAsk: () => void
	onDelineate: () => void
	onCopy: () => void
	onDelete: () => void
	onClose: () => void
}

/**
 * What a click on a pin opens. It shows what the user wrote (name, note), where the pin is and what they can do with
 * it. It never shows internals: no layer id, no colour field, no generic property table.
 *
 * Edits are a draft until saved: Save, Enter in the name, or Ctrl/Cmd+Enter in the note commits them, and the status line
 * says "Unsaved changes" until then. Nothing is lost if the card is left unsaved: moving focus out of the card, closing
 * it, or selecting another pin commits the draft first. After a commit the line reads "Saving" until the extension host
 * acknowledges that save, then "Saved"; a save the host did not take reads "Not saved" with Retry, and a save made
 * before the project is known reads that it is on this device only.
 */
const PinCard: React.FC<PinCardProps> = ({
	pin,
	mapStyle,
	focusName = false,
	onSave,
	onRetry,
	saveStatus,
	onAsk,
	onDelineate,
	onCopy,
	onDelete,
	onClose,
}) => {
	const [name, setName] = useState(pin.name)
	const [note, setNote] = useState(pin.notes)
	const [copied, setCopied] = useState(false)
	/** What this card's last commit is waiting on (see pinSavePhase). */
	const [awaiting, setAwaiting] = useState<number | "local" | null>(null)
	const nameRef = useRef<HTMLInputElement>(null)
	const rootRef = useRef<HTMLDivElement>(null)
	const [lon, lat] = pinCoords(pin)

	const trimmed = name.trim()
	const dirty = (trimmed !== "" && trimmed !== pin.name) || note !== pin.notes

	// The latest draft, for the commits that run when the card is left (cleanup cannot see this render's state).
	const draft = useRef({ id: pin.id, name, note, pinName: pin.name, pinNotes: pin.notes })
	useEffect(() => {
		draft.current = { id: pin.id, name, note, pinName: pin.name, pinNotes: pin.notes }
	})
	const saveRef = useRef(onSave)
	saveRef.current = onSave

	/** Commit the draft if there is one. Safe to call from anywhere, any number of times. */
	const commit = (): void => {
		const d = draft.current
		const next = d.name.trim()
		if (next === "") {
			setName(pin.name) // a pin always has a name
		}
		const changed = (next !== "" && next !== d.pinName) || d.note !== d.pinNotes
		if (!changed) return
		const result = saveRef.current({ id: d.id, name: next === "" ? d.pinName : next, notes: d.note })
		if (result !== null) setAwaiting(result)
		// Reflect the commit at once so a second trigger (Enter, then blur) does not save twice.
		draft.current = { ...d, name: next === "" ? d.pinName : next, pinName: next === "" ? d.pinName : next, pinNotes: d.note }
	}

	// A different pin: commit what was typed for the old one before showing the new one, and on close.
	useEffect(
		() => () => {
			const d = draft.current
			const next = d.name.trim()
			if ((next !== "" && next !== d.pinName) || d.note !== d.pinNotes) {
				saveRef.current({ id: d.id, name: next === "" ? d.pinName : next, notes: d.note })
			}
		},
		[pin.id],
	)
	useEffect(() => setAwaiting(null), [pin.id])
	// The pin changed underneath (renamed from the Pins panel): show what is stored.
	useEffect(() => setName(pin.name), [pin.id, pin.name])
	useEffect(() => setNote(pin.notes), [pin.id, pin.notes])
	// A save that waited for the project to be known is sent when it is: from then on the card waits for that save.
	useEffect(() => {
		if (awaiting === "local" && !saveStatus.unscoped) setAwaiting(saveStatus.requested)
	}, [awaiting, saveStatus.unscoped, saveStatus.requested])

	const phase = pinSavePhase(saveStatus, awaiting)

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
			onBlur={() => {
				// Focus left the card (the map, another panel): commit the draft rather than lose it.
				window.setTimeout(() => {
					if (rootRef.current && !rootRef.current.contains(document.activeElement)) commit()
				}, 0)
			}}
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
			ref={rootRef}
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
					onChange={(e) => setName(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault()
							commit()
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
				onChange={(e) => setNote(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
						e.preventDefault()
						commit()
					} else if (e.key === "Escape") {
						setNote(pin.notes)
					}
				}}
				placeholder="Add a note (Ctrl+Enter to save)"
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
				{action(MAP_ACTIONS.ask.icon, actionLabel("ask"), onAsk, accent)}
				{action(MAP_ACTIONS.delineate.icon, actionLabel("delineate"), onDelineate)}
				{action(
					copied ? "check" : "copy",
					copied ? "Copied" : actionLabel("copy-coords"),
					() => {
						onCopy()
						setCopied(true)
						window.setTimeout(() => setCopied(false), 1200)
					},
					undefined,
				)}
				{action(MAP_ACTIONS["remove-pin"].icon, actionLabel("remove-pin"), onDelete, danger)}
			</div>
			<div style={{ color: muted, fontSize: 11 }}>Your note. Not a measurement.</div>
			<div
				data-testid="pin-save-row"
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					minHeight: 28,
					borderTop: `1px solid ${bd}`,
					paddingTop: 6,
				}}>
				<span
					aria-live="polite"
					data-save-state={dirty ? "dirty" : phase}
					role="status"
					style={{
						flex: 1,
						minWidth: 0,
						color: phase === "failed" && !dirty ? danger : muted,
						fontSize: 11,
						lineHeight: 1.35,
					}}>
					{dirty ? (
						<>
							<span
								aria-hidden="true"
								className="codicon codicon-circle-small-filled"
								style={{ marginRight: 3, color: accent }}
							/>
							Unsaved changes
						</>
					) : phase === "saving" ? (
						<>
							<span
								aria-hidden="true"
								className="codicon codicon-loading codicon-modifier-spin"
								style={{ marginRight: 5 }}
							/>
							Saving
						</>
					) : phase === "saved" ? (
						<>
							<span aria-hidden="true" className="codicon codicon-check" style={{ marginRight: 5 }} />
							Saved
						</>
					) : phase === "local" ? (
						<>
							<span aria-hidden="true" className="codicon codicon-device-desktop" style={{ marginRight: 5 }} />
							Saved on this device only. The project is not ready to store it yet.
						</>
					) : phase === "failed" ? (
						<>
							<span aria-hidden="true" className="codicon codicon-warning" style={{ marginRight: 5 }} />
							Not saved to the project. Retry, or check that the folder is still open.
						</>
					) : null}
				</span>
				{!dirty && phase === "failed" && (
					<button
						onClick={() => setAwaiting(onRetry())}
						style={{
							minHeight: 24,
							padding: "2px 10px",
							fontSize: 12,
							background: "transparent",
							color: fg,
							border: `1px solid ${bd}`,
							borderRadius: 4,
							cursor: "pointer",
						}}
						type="button">
						Retry
					</button>
				)}
				{dirty && (
					<button
						onClick={commit}
						style={{
							minHeight: 24,
							padding: "2px 12px",
							fontSize: 12,
							fontWeight: 600,
							background: "var(--vscode-button-background, #0e639c)",
							color: "var(--vscode-button-foreground, #fff)",
							border: "none",
							borderRadius: 4,
							cursor: "pointer",
						}}
						title="Save (Enter in the name, Ctrl+Enter in the note)"
						type="button">
						Save
					</button>
				)}
			</div>
		</div>
	)
}

export default PinCard
