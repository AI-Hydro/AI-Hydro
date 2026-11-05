import React, { useState } from "react"
import type { GaugeInfo } from "./gaugeInfo"
import {
	DEFAULT_TRACE_KM,
	describeTrace,
	directionLabel,
	parseTraceDistance,
	type TraceDirection,
	type TraceLayerInfo,
	type TraceRequest,
	traceAvailability,
} from "./networkTrace"

export interface TracePalette {
	fg: string
	muted: string
	accentText: string
	border: string
	warn: string
}

interface GaugeTraceSectionProps {
	gauge: GaugeInfo
	/** Trace layers already on the map for this gauge. */
	traces: TraceLayerInfo[]
	/** A trace asked for in the chat whose layer has not arrived. */
	request?: TraceRequest | null
	/** The chat is starting; no second request meanwhile. */
	busy?: boolean
	/** Why the last request did not go out (chat kept, no chat input). */
	requestNote?: string | null
	palette: TracePalette
	onTrace?: (direction: TraceDirection, distanceKm: number) => void
	onStopWaiting?: () => void
}

/** "Trace" block of the gauge card: ask for a network trace, wait for its layer, read what it is. */
export const GaugeTraceSection: React.FC<GaugeTraceSectionProps> = ({
	gauge,
	traces,
	request,
	busy = false,
	requestNote,
	palette: { muted, accentText, border, warn },
	onTrace,
	onStopWaiting,
}) => {
	const [distance, setDistance] = useState(String(DEFAULT_TRACE_KM))
	const available = traceAvailability(gauge)
	const parsed = parseTraceDistance(distance)
	const waiting = request && request.siteNo === gauge.siteNo ? request : null

	const small: React.CSSProperties = { fontSize: 11, lineHeight: 1.35 }
	const button: React.CSSProperties = {
		flex: 1,
		minHeight: 24,
		padding: "4px 8px",
		fontSize: 11,
		border: `1px solid ${border}`,
		borderRadius: 4,
		background: "transparent",
		color: accentText,
		cursor: "pointer",
	}

	return (
		<div aria-label="Network trace" role="group" style={{ marginBottom: 6, paddingTop: 6, borderTop: `1px solid ${border}` }}>
			<div style={{ ...small, color: muted, marginBottom: 4 }}>Trace the river network</div>

			{!available.available ? (
				<div role="note" style={{ ...small, color: muted }}>
					{available.message}
				</div>
			) : (
				<>
					<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
						<label htmlFor="trace-distance" style={{ ...small, color: muted }}>
							Distance (km)
						</label>
						<input
							aria-invalid={"error" in parsed}
							id="trace-distance"
							inputMode="numeric"
							onChange={(e) => setDistance(e.target.value)}
							style={{
								width: 52,
								minHeight: 24,
								padding: "0 4px",
								fontSize: 11,
								color: "var(--vscode-input-foreground)",
								background: "var(--vscode-input-background)",
								border: `1px solid ${"error" in parsed ? warn : "var(--vscode-input-border, " + border + ")"}`,
								borderRadius: 3,
							}}
							type="text"
							value={distance}
						/>
					</div>
					{"error" in parsed && (
						<div role="alert" style={{ ...small, color: warn, marginBottom: 4 }}>
							{parsed.error}
						</div>
					)}
					<div style={{ display: "flex", gap: 4 }}>
						{(["upstream", "downstream"] as const).map((d) => (
							<button
								disabled={busy || !!waiting || "error" in parsed || !onTrace}
								key={d}
								onClick={() => "km" in parsed && onTrace?.(d, parsed.km)}
								style={{ ...button, opacity: busy || waiting || "error" in parsed ? 0.6 : 1 }}
								title={
									d === "upstream"
										? "Every tributary above the gauge within the distance, from NLDI. Asks the agent; you approve the tool call in the chat"
										: "The main stem below the gauge within the distance, from NLDI. Asks the agent; you approve the tool call in the chat"
								}
								type="button">
								{directionLabel(d)}
							</button>
						))}
					</div>
					{requestNote && !waiting && <div style={{ ...small, color: muted, marginTop: 4 }}>{requestNote}</div>}
				</>
			)}

			{waiting && (
				<div aria-live="polite" role="status" style={{ ...small, marginTop: 6 }}>
					<div>
						Tracing {waiting.direction}, {waiting.distanceKm} km, in the chat. The layer appears in Results when the
						run finishes.
					</div>
					<div style={{ color: muted, marginTop: 2 }}>
						It runs once you send the message and approve the tool call. If NLDI does not know this gauge, the agent
						says so and no layer is added.
					</div>
					{onStopWaiting && (
						<button
							onClick={onStopWaiting}
							style={{
								...button,
								flex: "none",
								marginTop: 4,
								border: "none",
								textDecoration: "underline",
								padding: "0 4px",
							}}
							type="button">
							Stop waiting
						</button>
					)}
				</div>
			)}

			{traces.map((t) => (
				<TraceResult info={t} key={t.layerId} palette={{ muted, accentText, border, warn, fg: "" }} />
			))}
		</div>
	)
}

/** What one traced layer is: its direction, distance, source and counts, any cut, and what kind of result it is. */
export const TraceResult: React.FC<{ info: TraceLayerInfo; palette: TracePalette }> = ({
	info,
	palette: { muted, accentText, warn },
}) => {
	const d = describeTrace(info)
	return (
		<div aria-label={`Trace: ${d.title}`} role="group" style={{ marginTop: 6, fontSize: 11, lineHeight: 1.35 }}>
			<div style={{ fontWeight: 600, wordBreak: "break-word" }}>{d.title}</div>
			{d.cut && (
				<div role="note" style={{ marginTop: 4, color: warn, fontWeight: 600 }}>
					{d.cut}
				</div>
			)}
			{d.rows.map(([label, value]) => (
				<div key={label} style={{ display: "grid", gridTemplateColumns: "72px 1fr", gap: "2px 8px", marginTop: 2 }}>
					<span style={{ color: muted }}>{label}</span>
					<span
						style={{
							color: value === "not recorded" ? muted : accentText,
							fontStyle: value === "not recorded" ? "italic" : undefined,
							wordBreak: "break-word",
						}}>
						{value}
					</span>
				</div>
			))}
			{d.notes.map((note) => (
				<div key={note} role="note" style={{ marginTop: 4, color: muted }}>
					{note}
				</div>
			))}
		</div>
	)
}
