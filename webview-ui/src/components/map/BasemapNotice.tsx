import React, { useEffect, useState } from "react"
import { MAP_Z } from "./mapZ"

/**
 * Non-blocking basemap notices. Unlike MapResourceStatus (tile errors, Retry), these cover cases where nothing
 * errors but the basemap cannot show a map:
 *   - coverage: the viewport is outside a US-only basemap's coverage (blank tiles by design);
 *   - placeholder: the source answers every request with one identical image (provider placeholder);
 *   - migrated: a saved basemap was removed and the default was used instead.
 * Each offers switching to the hydrology default and can be dismissed. The message is keyed so a dismissal
 * applies to that message only.
 */
export interface BasemapNoticeProps {
	messages: { key: string; text: string }[]
	/** Switch to the default basemap (omitted when the default is already active). */
	onUseDefault?: () => void
}

export const BasemapNotice: React.FC<BasemapNoticeProps> = ({ messages, onUseDefault }) => {
	const [dismissed, setDismissed] = useState<Set<string>>(new Set())
	// A dismissal lasts only while its message stays on screen: when the condition clears (the view pans back
	// into coverage) and later returns, the notice is shown again.
	const activeKeys = messages.map((message) => message.key).join("\u0000")
	useEffect(() => {
		const active = new Set(activeKeys ? activeKeys.split("\u0000") : [])
		setDismissed((previous) => {
			const kept = new Set([...previous].filter((key) => active.has(key)))
			return kept.size === previous.size ? previous : kept
		})
	}, [activeKeys])
	const visible = messages.filter((message) => !dismissed.has(message.key))
	if (visible.length === 0) return null
	const button: React.CSSProperties = { minHeight: 24, minWidth: 24, padding: "2px 8px" }
	return (
		<div
			role="status"
			style={{
				position: "absolute",
				top: 12,
				left: "50%",
				transform: "translateX(-50%)",
				zIndex: MAP_Z.toast,
				maxWidth: "min(460px, calc(100% - 24px))",
				padding: 10,
				background: "var(--vscode-editor-background)",
				color: "var(--vscode-foreground)",
				border: "1px solid var(--vscode-editorInfo-foreground, var(--vscode-editorWarning-foreground))",
				borderRadius: 4,
			}}>
			{visible.map((message) => (
				<div key={message.key} style={{ marginBottom: 6 }}>
					{message.text}
				</div>
			))}
			<div style={{ display: "flex", gap: 6 }}>
				{onUseDefault && (
					<button onClick={onUseDefault} style={button} type="button">
						Use Hydrology default
					</button>
				)}
				<button
					aria-label="Dismiss basemap notice"
					onClick={() => setDismissed(new Set([...dismissed, ...visible.map((message) => message.key)]))}
					style={button}
					type="button">
					Dismiss
				</button>
			</div>
		</div>
	)
}

export default BasemapNotice
