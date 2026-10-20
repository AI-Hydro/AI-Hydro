import React from "react"
import { isRealUserGesture } from "./ArtifactTrustBar"

interface AgentHandoffPromptProps {
	prompt: string
	sending?: boolean
	onSend: () => void
	onDismiss: () => void
}

/**
 * A document asked to hand work to the agent. Nothing is sent until the user
 * reads the exact prompt below and clicks "Send to agent".
 */
export const AgentHandoffPrompt: React.FC<AgentHandoffPromptProps> = ({ prompt, sending, onSend, onDismiss }) => (
	<div
		aria-label="Agent task request"
		data-testid="agent-handoff-prompt"
		role="alertdialog"
		style={{
			display: "flex",
			flexDirection: "column",
			gap: 6,
			padding: "8px 10px",
			fontSize: 11,
			lineHeight: 1.4,
			color: "var(--vscode-foreground, #ccc)",
			background: "var(--vscode-inputValidation-warningBackground, rgba(210,153,34,0.12))",
			borderBottom: "1px solid var(--vscode-inputValidation-warningBorder, rgba(210,153,34,0.5))",
		}}>
		<strong>This document wants to start an agent task. Review the prompt before it is sent.</strong>
		<pre
			data-testid="agent-handoff-prompt-text"
			style={{
				margin: 0,
				padding: 6,
				maxHeight: 140,
				overflow: "auto",
				whiteSpace: "pre-wrap",
				wordBreak: "break-word",
				fontFamily: "var(--vscode-editor-font-family, monospace)",
				background: "var(--vscode-textCodeBlock-background, rgba(128,128,128,0.15))",
				borderRadius: 3,
			}}>
			{prompt}
		</pre>
		<div style={{ display: "flex", gap: 8 }}>
			<button
				data-testid="agent-handoff-send"
				disabled={sending}
				onClick={(event) => {
					if (isRealUserGesture(event)) onSend()
				}}
				style={{ padding: "2px 10px", fontSize: 11, cursor: "pointer" }}
				type="button">
				Send to agent
			</button>
			<button
				data-testid="agent-handoff-dismiss"
				onClick={onDismiss}
				style={{ padding: "2px 10px", fontSize: 11, cursor: "pointer" }}
				type="button">
				Dismiss
			</button>
		</div>
	</div>
)
