import { type ArtifactTrustState, describeArtifactTrust } from "@shared/artifactTrust"
import React from "react"

/**
 * User gestures in the shell must be real clicks. A document is same-origin with
 * the shell (srcdoc iframe), so its script could call `button.click()` on the
 * shell's own controls; synthetic events are not `isTrusted`. Vitest/jsdom cannot
 * produce trusted events, so test builds are exempt (the literal is replaced at
 * build time and the branch is removed from production bundles).
 */
export function isRealUserGesture(event: { nativeEvent?: Event }): boolean {
	return import.meta.env.MODE === "test" || event.nativeEvent?.isTrusted === true
}

interface ArtifactTrustBarProps {
	trust: ArtifactTrustState
	busy?: boolean
	onAllow: () => void
	onRevoke: () => void
	/**
	 * Opens the "Install Learning Pack" flow. Offered only on a read-only course copy (an unsigned catalogue
	 * module), as host chrome: it needs a real, trusted click, so document script can never trigger it, and the
	 * flow it opens still asks the user to approve before anything is installed.
	 */
	onInstallPack?: () => void
}

/**
 * Persistent trust badge for the open document. It states what is actually
 * enforced (the host refuses Python and agent requests from any document that is
 * not trusted and allowed) and carries the allow / revoke action.
 */
export const ArtifactTrustBar: React.FC<ArtifactTrustBarProps> = ({ trust, busy, onAllow, onRevoke, onInstallPack }) => {
	const { label, detail } = describeArtifactTrust(trust)
	const tone = trust.allowed ? "allowed" : trust.trusted ? "trusted" : "untrusted"
	const accent =
		tone === "allowed"
			? "var(--vscode-charts-green, #3fb950)"
			: tone === "trusted"
				? "var(--vscode-charts-yellow, #d29922)"
				: "var(--vscode-descriptionForeground, #999)"
	return (
		<div
			data-testid="artifact-trust-bar"
			data-trust-source={trust.source}
			data-trust-state={tone}
			role="note"
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "5px 10px",
				fontSize: 11,
				lineHeight: 1.4,
				color: "var(--vscode-foreground, #ccc)",
				background: "var(--vscode-editorWidget-background, rgba(128,128,128,0.08))",
				borderBottom: "1px solid var(--vscode-panel-border, rgba(128,128,128,0.3))",
			}}>
			<span
				data-testid="artifact-trust-badge"
				style={{
					flexShrink: 0,
					padding: "1px 7px",
					borderRadius: 9,
					fontWeight: 600,
					color: accent,
					border: `1px solid ${accent}`,
				}}>
				{label}
			</span>
			<span style={{ flex: 1, minWidth: 0 }}>
				{trust.source === "document" && !trust.integrityFailure ? <strong>This is a static document. </strong> : null}
				{detail}
			</span>
			{trust.source === "unsigned-module" && onInstallPack && (
				<button
					data-testid="artifact-trust-install-pack"
					onClick={(event) => {
						if (isRealUserGesture(event)) onInstallPack()
					}}
					style={buttonStyle}
					title="Choose a signed .aihydropack file and review it before installing"
					type="button">
					Install Learning Pack…
				</button>
			)}
			{trust.trusted && !trust.allowed && (
				<button
					data-testid="artifact-trust-allow"
					disabled={busy}
					onClick={(event) => {
						if (isRealUserGesture(event)) onAllow()
					}}
					style={buttonStyle}
					title="Allow this document to run Python and hand work to the agent"
					type="button">
					Allow execution
				</button>
			)}
			{trust.allowed && (
				<button
					data-testid="artifact-trust-revoke"
					disabled={busy}
					onClick={(event) => {
						if (isRealUserGesture(event)) onRevoke()
					}}
					style={buttonStyle}
					title="Stop this document from running Python or starting agent tasks"
					type="button">
					Revoke
				</button>
			)}
		</div>
	)
}

const buttonStyle: React.CSSProperties = {
	flexShrink: 0,
	padding: "2px 9px",
	fontSize: 11,
	cursor: "pointer",
	color: "var(--vscode-button-secondaryForeground, inherit)",
	background: "var(--vscode-button-secondaryBackground, transparent)",
	border: "1px solid var(--vscode-button-border, var(--vscode-panel-border, rgba(128,128,128,0.5)))",
	borderRadius: 3,
}
