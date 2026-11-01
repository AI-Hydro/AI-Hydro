import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { ClickedFeature } from "./FeatureIdentifier"
import { actionLabel, actionTooltip, MAP_ACTIONS, mapActions, objectKind } from "./mapActions"
import { MAP_Z } from "./mapZ"
import { formatPinCoords, pinLabel } from "./pins"

function fmtArea(km2: number): string {
	return km2 >= 1000 ? `${(km2 / 1000).toFixed(1)} ×10³ km²` : `${km2.toFixed(0)} km²`
}

export interface MapContextMenuProps {
	x: number
	y: number
	lon: number
	lat: number
	features: ClickedFeature[]
	/** The pin under the pointer, if any. Its actions get their own section. */
	pin?: { id: string; name: string }
	mapStyle: string
	agentStarting?: boolean
	delineating?: boolean
	onAskAiHydro: (question: string) => void
	/** Opens a chat and lets the agent delineate (records a run). */
	onAgentDelineate: () => void
	/** Runs the interactive MERIT delineation directly, with no chat. */
	onQuickDelineate: () => void
	onAddPin: () => void
	onMeasureFrom: () => void
	onCopyCoords: () => void
	onInspect: () => void
	onSaveFeature: (format: "geojson" | "shapefile") => void
	/** Add the feature under the pointer to the selection set (the card's Select). */
	onSelectFeature?: () => void
	onRemoveLayer?: () => void
	onRenamePin?: () => void
	onRemovePin?: () => void
	onAskAboutPin?: () => void
	onClose: () => void
}

const MapContextMenu: React.FC<MapContextMenuProps> = ({
	x,
	y,
	lon,
	lat,
	features,
	pin,
	mapStyle,
	agentStarting = false,
	delineating = false,
	onAskAiHydro,
	onAgentDelineate,
	onQuickDelineate,
	onAddPin,
	onMeasureFrom,
	onCopyCoords,
	onInspect,
	onSaveFeature,
	onSelectFeature,
	onRemoveLayer,
	onRenamePin,
	onRemovePin,
	onAskAboutPin,
	onClose,
}) => {
	const [askOpen, setAskOpen] = useState(false)
	const [question, setQuestion] = useState("")
	const [copiedFeedback, setCopiedFeedback] = useState(false)
	const [pos, setPos] = useState({ left: x, top: y })
	const rootRef = useRef<HTMLDivElement>(null)
	const textareaRef = useRef<HTMLTextAreaElement>(null)

	const kind = objectKind(features)
	const ctx = kind === "basin" ? "watershed" : kind === "empty" ? "empty" : kind === "river" ? "river" : "feature"
	// What the menu offers comes from the shared list; a handler this surface was not given hides its action.
	const featureActions = mapActions(kind, "menu")
	const inSection = (section: string) => featureActions.filter((a) => a.section === section)
	const primary = features[0]
	const props = primary?.properties ?? {}
	const busy = agentStarting || delineating

	const isDark = mapStyle === "dark"
	const bg = isDark ? "rgba(20,20,28,0.97)" : "rgba(252,252,252,0.97)"
	const fg = isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.88)"
	const bdClr = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.11)"
	const muted = isDark ? "rgba(255,255,255,0.62)" : "rgba(0,0,0,0.62)"
	const accentText = isDark ? "#7ec8ff" : "#0e639c"
	const accentBg = isDark ? "rgba(30,90,140,0.60)" : "rgba(14,99,156,0.16)"
	const hoverBg = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)"
	const dangerText = isDark ? "#f87171" : "#dc2626"

	const coordLine = formatPinCoords(lon, lat)

	const objectLabel = {
		watershed: "Watershed",
		river: "Stream / River",
		feature: primary?.layerName ?? "Feature",
		empty: "",
	}[ctx]
	const subject = { watershed: "basin", river: "stream", feature: "feature", empty: "location" }[ctx]

	// Keep the whole menu inside the map: measure it once it has content, then slide it back in.
	useLayoutEffect(() => {
		const el = rootRef.current
		const parent = el?.offsetParent as HTMLElement | null
		if (!el || !parent) return
		const maxLeft = Math.max(4, parent.clientWidth - el.offsetWidth - 4)
		const maxTop = Math.max(4, parent.clientHeight - el.offsetHeight - 4)
		setPos({ left: Math.max(4, Math.min(x, maxLeft)), top: Math.max(4, Math.min(y, maxTop)) })
	}, [x, y, askOpen, ctx, pin?.id])

	useEffect(() => {
		if (askOpen) {
			textareaRef.current?.focus()
		}
	}, [askOpen])

	// Focus the first item so the menu is usable from the keyboard.
	useEffect(() => {
		rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
	}, [])

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return
			if (askOpen) {
				setAskOpen(false)
				setQuestion("")
			} else onClose()
			e.stopPropagation()
		}
		window.addEventListener("keydown", handler, true)
		return () => window.removeEventListener("keydown", handler, true)
	}, [askOpen, onClose])

	const onMenuKeyDown = (e: React.KeyboardEvent) => {
		if ((e.target as HTMLElement).tagName === "TEXTAREA") return
		const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
		if (items.length === 0) return
		const at = items.indexOf(document.activeElement as HTMLElement)
		let next: number | null = null
		if (e.key === "ArrowDown") next = (at + 1) % items.length
		else if (e.key === "ArrowUp") next = (at - 1 + items.length) % items.length
		else if (e.key === "Home") next = 0
		else if (e.key === "End") next = items.length - 1
		if (next !== null) {
			e.preventDefault()
			items[next].focus()
		}
	}

	const handleCopy = () => {
		void navigator.clipboard?.writeText(coordLine)
		onCopyCoords()
		setCopiedFeedback(true)
		setTimeout(() => {
			setCopiedFeedback(false)
			onClose()
		}, 900)
	}

	const act = (fn: () => void) => () => {
		fn()
		onClose()
	}

	const item = (extra?: React.CSSProperties): React.CSSProperties => ({
		display: "flex",
		alignItems: "center",
		gap: 8,
		width: "100%",
		minHeight: 28,
		padding: "4px 11px",
		background: "transparent",
		border: "none",
		color: fg,
		cursor: "pointer",
		fontSize: 12,
		textAlign: "left",
		lineHeight: 1.3,
		...extra,
	})
	const divider: React.CSSProperties = { height: 1, background: bdClr, margin: "2px 0" }

	const Btn = ({
		icon,
		label,
		hint,
		onClick,
		color,
		disabled,
		title,
	}: {
		icon: string
		label: string
		hint?: string
		onClick: () => void
		color?: string
		disabled?: boolean
		title?: string
	}) => (
		<button
			aria-disabled={disabled || undefined}
			onClick={disabled ? undefined : onClick}
			onMouseEnter={(e) => !disabled && ((e.currentTarget as HTMLElement).style.background = hoverBg)}
			onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
			role="menuitem"
			style={item({
				color: disabled ? muted : (color ?? fg),
				cursor: disabled ? "not-allowed" : "pointer",
				opacity: disabled ? 0.7 : 1,
			})}
			tabIndex={-1}
			title={title ?? hint}
			type="button">
			<span aria-hidden="true" className={`codicon codicon-${icon}`} style={{ width: 16, flexShrink: 0, fontSize: 14 }} />
			<span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
				<span>{label}</span>
				{hint && <span style={{ fontSize: 11, color: muted, fontWeight: 400 }}>{hint}</span>}
			</span>
		</button>
	)

	// Called as a function, not rendered as a component: a component type declared in render is a new type every
	// render, which would remount the question textarea (and drop its focus) on every keystroke.
	const group = (label: string, children: React.ReactNode) => (
		<div aria-label={label} role="group" style={{ padding: "3px 0" }}>
			<div
				aria-hidden="true"
				style={{
					padding: "2px 11px 1px",
					fontSize: 11,
					fontWeight: 600,
					color: muted,
					textTransform: "uppercase",
					letterSpacing: "0.04em",
				}}>
				{label}
			</div>
			{children}
		</div>
	)
	const separator = <div role="separator" style={divider} />

	return (
		<div
			aria-label="Map actions"
			data-map-chrome="menu"
			onClick={(e) => e.stopPropagation()}
			onKeyDown={onMenuKeyDown}
			onMouseDown={(e) => e.stopPropagation()}
			ref={rootRef}
			role="menu"
			style={{
				position: "absolute",
				left: pos.left,
				top: pos.top,
				zIndex: MAP_Z.menu,
				minWidth: 220,
				maxWidth: 270,
				background: bg,
				border: `1px solid ${bdClr}`,
				borderRadius: 8,
				boxShadow: "0 6px 20px rgba(0,0,0,0.40)",
				fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
				fontSize: 12,
				color: fg,
				pointerEvents: "auto",
				userSelect: "none",
				overflow: "hidden",
			}}>
			{/* Header: where you clicked */}
			<div role="presentation" style={{ padding: "7px 11px 6px", borderBottom: `1px solid ${bdClr}` }}>
				<div style={{ fontSize: 11, color: muted, fontFamily: "monospace", lineHeight: 1.3 }}>{coordLine}</div>
			</div>

			{/* AI-Hydro */}
			{group(
				"AI-Hydro",
				<>
					{!askOpen ? (
						<Btn
							color={accentText}
							icon="sparkle"
							label={`${actionLabel("ask")}…`}
							onClick={() => setAskOpen(true)}
							title={actionTooltip("ask")}
						/>
					) : (
						<div aria-label="Ask AI-Hydro" role="group" style={{ padding: "4px 10px 8px" }}>
							<div style={{ fontSize: 11, color: muted, marginBottom: 4 }}>
								{ctx === "watershed"
									? "e.g. What does this basin's Pfaf code indicate?"
									: ctx === "river"
										? "e.g. What is the stream order and flood potential?"
										: "e.g. What's the hydrology context here?"}
							</div>
							<textarea
								aria-label="Question for AI-Hydro"
								onChange={(e) => setQuestion(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault()
										onAskAiHydro(question.trim())
										onClose()
									}
								}}
								placeholder="Type a question…"
								ref={textareaRef}
								rows={3}
								style={{
									width: "100%",
									boxSizing: "border-box",
									resize: "none",
									background: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)",
									border: `1px solid ${bdClr}`,
									borderRadius: 4,
									color: fg,
									fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
									fontSize: 12,
									padding: "4px 6px",
									outline: "none",
								}}
								value={question}
							/>
							<div style={{ display: "flex", gap: 5, marginTop: 5 }}>
								<button
									disabled={busy}
									onClick={() => {
										onAskAiHydro(question.trim())
										onClose()
									}}
									style={{
										flex: 1,
										minHeight: 24,
										padding: "4px 6px",
										fontSize: 12,
										fontWeight: 700,
										background: accentBg,
										color: accentText,
										border: `1px solid ${bdClr}`,
										borderRadius: 4,
										cursor: busy ? "wait" : "pointer",
										opacity: busy ? 0.7 : 1,
									}}
									type="button">
									{agentStarting ? "Opening…" : "Send"}
								</button>
								<button
									aria-label="Cancel question"
									onClick={() => {
										setAskOpen(false)
										setQuestion("")
									}}
									style={{
										minWidth: 28,
										minHeight: 24,
										background: "transparent",
										color: muted,
										border: `1px solid ${bdClr}`,
										borderRadius: 4,
										cursor: "pointer",
									}}
									type="button">
									<span aria-hidden="true" className="codicon codicon-close" />
								</button>
							</div>
						</div>
					)}
					{(["delineate", "delineate-quick"] as const).map((id) => (
						<Btn
							disabled={busy}
							icon={MAP_ACTIONS[id].icon}
							key={id}
							label={actionLabel(id)}
							onClick={act(id === "delineate" ? onAgentDelineate : onQuickDelineate)}
							title={actionTooltip(id, primary, { lon, lat })}
						/>
					))}
				</>,
			)}

			{separator}

			{/* The pin under the pointer */}
			{pin && (
				<>
					{group(
						`Pin: ${pinLabel(pin)}`,
						<>
							{onRenamePin && (
								<Btn
									icon={MAP_ACTIONS["rename-pin"].icon}
									label={actionLabel("rename-pin")}
									onClick={act(onRenamePin)}
								/>
							)}
							{onAskAboutPin && (
								<Btn
									color={accentText}
									icon={MAP_ACTIONS.ask.icon}
									label={actionLabel("ask")}
									onClick={act(onAskAboutPin)}
								/>
							)}
							{onRemovePin && (
								<Btn
									color={dangerText}
									icon={MAP_ACTIONS["remove-pin"].icon}
									label={actionLabel("remove-pin")}
									onClick={act(onRemovePin)}
								/>
							)}
						</>,
					)}
					{separator}
				</>
			)}

			{/* The layer feature under the pointer */}
			{ctx !== "empty" && (
				<>
					{group(
						objectLabel,
						<>
							{(ctx === "watershed" || ctx === "river") && (
								<div
									role="presentation"
									style={{ padding: "0 11px 2px", fontSize: 11, color: accentText, fontFamily: "monospace" }}>
									{ctx === "watershed" && props.area_km2 != null && fmtArea(Number(props.area_km2))}
									{ctx === "river" && props.uparea != null && `upstream ${Number(props.uparea).toFixed(0)} km²`}
								</div>
							)}
							{inSection("object").map((a) => {
								const handler: Record<string, (() => void) | undefined> = {
									inspect: onInspect,
									select: onSelectFeature,
									"export-geojson": () => onSaveFeature("geojson"),
									"export-shapefile": () => onSaveFeature("shapefile"),
									"remove-layer": onRemoveLayer,
								}
								const run = handler[a.id]
								if (!run) return null
								return (
									<Btn
										color={a.danger ? dangerText : undefined}
										icon={a.icon}
										key={a.id}
										label={a.label}
										onClick={act(run)}
										title={a.tooltip}
									/>
								)
							})}
						</>,
					)}
					{separator}
				</>
			)}

			{/* Map */}
			{group(
				"Map",
				<>
					{inSection("map").map((a) =>
						a.id === "copy-coords" ? (
							<Btn
								color={copiedFeedback ? accentText : undefined}
								icon={copiedFeedback ? "check" : a.icon}
								key={a.id}
								label={copiedFeedback ? "Copied" : a.label}
								onClick={handleCopy}
							/>
						) : (
							<Btn
								icon={a.icon}
								key={a.id}
								label={a.label}
								onClick={act(a.id === "add-pin" ? onAddPin : onMeasureFrom)}
							/>
						),
					)}
				</>,
			)}
		</div>
	)
}

export default MapContextMenu
