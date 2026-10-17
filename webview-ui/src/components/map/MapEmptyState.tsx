import { useRef, useState } from "react"
import { EmptyState } from "@/design"
import { ACCEPTED_EXTENSIONS } from "./formats"
import { startMapAgentTask } from "./mapAgentBridge"
import { buildStartInvestigationAgentPrompt } from "./mapAgentPrompts"

export interface MapEmptyStateProps {
	/** Load the chosen files through the same path as drag-and-drop. */
	onFilesPicked: (files: FileList) => void
	/** Open the ribbon search panel and focus its input. */
	onFindGauge: () => void
}

/** Empty map: an opaque card with three real buttons. The agent action is labelled as one. */
export function MapEmptyState({ onFilesPicked, onFindGauge }: MapEmptyStateProps) {
	const fileInputRef = useRef<HTMLInputElement>(null)
	const [agentStatus, setAgentStatus] = useState<string | null>(null)

	const startInvestigation = async () => {
		setAgentStatus("Sending request to the agent...")
		const result = await startMapAgentTask(buildStartInvestigationAgentPrompt())
		setAgentStatus(
			result.ok
				? "Agent task started. Continue in the chat sidebar."
				: `Could not start the agent task: ${result.error ?? "unknown error"}`,
		)
	}

	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				pointerEvents: "none",
				zIndex: 5,
			}}>
			<div style={{ pointerEvents: "auto", maxWidth: "min(420px, calc(100% - 96px))" }}>
				<input
					accept={ACCEPTED_EXTENSIONS}
					aria-label="Choose map files"
					multiple
					onChange={(e) => {
						if (e.target.files?.length) {
							onFilesPicked(e.target.files)
						}
						e.target.value = ""
					}}
					ref={fileInputRef}
					style={{ display: "none" }}
					tabIndex={-1}
					type="file"
				/>
				<EmptyState
					actions={[
						{ label: "Open a file…", icon: "folder-opened", onClick: () => fileInputRef.current?.click() },
						{ label: "Find a gauge", icon: "search", onClick: onFindGauge },
						{
							label: "Ask the agent: start a watershed investigation",
							icon: "hubot",
							onClick: () => void startInvestigation(),
						},
					]}
					description="Open a GeoJSON or raster file, search for a gauge, or ask the agent to start from a gauge or location. You can also drop files on the map."
					icon="map"
					title="No layers yet"
				/>
				{agentStatus && (
					<p
						aria-live="polite"
						role="status"
						style={{
							margin: "8px 0 0",
							fontSize: "var(--aih-text-label)",
							color: "var(--aih-fg)",
							background: "var(--aih-surface)",
							padding: "4px 8px",
							borderRadius: 4,
						}}>
						{agentStatus}
					</p>
				)}
			</div>
		</div>
	)
}
