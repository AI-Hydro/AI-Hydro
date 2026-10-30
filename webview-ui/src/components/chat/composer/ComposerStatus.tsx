import type { AlwaysAllowRefusalReason } from "@shared/aihydro/alwaysAllowPolicy"
import { useMemo, useRef, useState } from "react"
import { TrustLauncherButton } from "@/components/tools/TrustLauncherButton"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { Text } from "@/design"
import AutoApproveModal from "../auto-approve-menu/AutoApproveModal"
import { ACTION_METADATA, NOTIFICATIONS_SETTING } from "../auto-approve-menu/constants"
import { deriveAutoRunPolicy } from "./autoRunPolicy"
import { ComposerPopover } from "./ComposerPopover"
import { ContextRing } from "./ContextRing"
import "./composer.css"

/**
 * The claim-approval disclosure. It heads the auto-run popover (one click from the chip, wherever auto-run is
 * configured) and is not a permanent row: owner feedback on 0.4.2 was that the two status lines and this paragraph
 * took too much of the composer. The sentence itself is a security statement and must not be reworded or dropped.
 */
export const CLAIM_DISCLAIMER =
	"Does not approve claims. Claim approval is a signed step you perform in a terminal (aihydro-approve)."

const PAUSED_REASON_TEXT: Record<AlwaysAllowRefusalReason, string> = {
	untrusted_server: "the server is not trusted (its launcher changed or is not registered)",
	server_unavailable: "the server is not connected",
	unknown_tool: "the server does not list the tool exactly once",
	destructive: "the server declares the tool may be destructive",
	unknown_effect: "the server does not declare what the tool does",
}

interface ComposerStatusProps {
	/** Per-request context tokens (`lastApiReqTotalTokens`, same source as the task header's context bar). */
	contextTokens?: number
	contextWindow?: number
}

/**
 * The composer's single status row (one line, 24 px chips): the auto-run chip, a count chip for paused MCP grants
 * (only when there are any), and the context ring. Each chip opens a popover. A risky setting stays visible at rest as
 * a warning icon plus the word "risky" on the chip, and is named in its accessible name.
 */
export function ComposerStatus({ contextTokens, contextWindow }: ComposerStatusProps) {
	const { autoApprovalSettings, mcpServers, yoloModeToggled, navigateToMcp } = useExtensionState()
	const [open, setOpen] = useState(false)
	const [pausedOpen, setPausedOpen] = useState(false)
	const rowRef = useRef<HTMLDivElement>(null)
	const chipRef = useRef<HTMLButtonElement>(null)
	const pausedRef = useRef<HTMLButtonElement>(null)
	const policy = useMemo(
		() => deriveAutoRunPolicy(autoApprovalSettings, mcpServers, !!yoloModeToggled),
		[autoApprovalSettings, mcpServers, yoloModeToggled],
	)
	const toolNoun = (n: number) => (n === 1 ? "tool" : "tools")
	const pausedName = `${policy.mcpPaused} MCP ${toolNoun(policy.mcpPaused)} paused, asks first`

	return (
		<div className="aih-composer-status" data-testid="composer-status" ref={rowRef}>
			<button
				aria-expanded={open}
				aria-haspopup="dialog"
				aria-label={`${policy.summary}. Opens tool auto-run settings.`}
				className={`aih-chip${policy.risky ? " aih-chip--warn" : ""}`}
				data-testid="auto-run-chip"
				onClick={() => {
					setPausedOpen(false)
					setOpen((v) => !v)
				}}
				ref={chipRef}
				title={policy.summary}
				type="button">
				<span className="aih-chip__label">{policy.compactText}</span>
				{policy.risky && (
					<span className="aih-chip__risk" data-testid="auto-run-risk">
						<span aria-hidden="true" className="codicon codicon-warning" />
						<span>risky</span>
					</span>
				)}
			</button>
			{policy.mcpPaused > 0 && (
				<button
					aria-expanded={pausedOpen}
					aria-haspopup="dialog"
					aria-label={`${pausedName}. Opens details.`}
					className="aih-chip"
					data-testid="paused-chip"
					onClick={() => {
						setOpen(false)
						setPausedOpen((v) => !v)
					}}
					ref={pausedRef}
					title={pausedName}
					type="button">
					<span className="aih-chip__label">{policy.mcpPaused} paused</span>
				</button>
			)}
			<span className="aih-composer-status__ring">
				<ContextRing contextWindow={contextWindow} used={contextTokens} />
			</span>
			<ComposerPopover
				anchorRef={pausedRef}
				label="Paused MCP tools"
				onClose={() => setPausedOpen(false)}
				open={pausedOpen && policy.mcpPaused > 0}
				testId="paused-popover">
				<p className="aih-popover__title">{pausedName}</p>
				<p className="aih-popover__body">
					These tools have an Always allow grant that the host will not honour right now, so each one asks before it
					runs. Nothing here runs without you.
				</p>
				<ul className="aih-popover__list" data-testid="paused-reasons">
					{(Object.entries(policy.mcpPausedReasons) as [AlwaysAllowRefusalReason, number][]).map(([reason, n]) => (
						<li key={reason}>
							{n} {toolNoun(n)}: {PAUSED_REASON_TEXT[reason]}
						</li>
					))}
				</ul>
				<p className="aih-popover__body">
					To fix it, check that the server is connected and shows Trusted in Hydro Tools &amp; Data Sources. Tools the
					server does not declare as read-only or non-destructive stay on ask.
				</p>
				{/* The host-owned action (modal confirmation of the exact command); the popover never records trust itself. */}
				{policy.mcpPausedUntrustedServers.map((serverName) => (
					<TrustLauncherButton
						className="aih-menu-item"
						key={serverName}
						serverName={serverName}
						testId="trust-launcher-action"
					/>
				))}
				<button
					className="aih-menu-item"
					data-testid="open-mcp-view"
					onClick={() => {
						setPausedOpen(false)
						navigateToMcp?.()
					}}
					type="button">
					<span aria-hidden="true" className="codicon codicon-server" />
					<span>Open Hydro Tools &amp; Data Sources</span>
				</button>
			</ComposerPopover>
			<AutoApproveModal
				ACTION_METADATA={ACTION_METADATA}
				buttonRef={rowRef}
				header={
					<div data-testid="popover-summary">
						<Text as="p" className="mb-2" variant="label">
							{policy.chipText}
						</Text>
						{policy.risky && (
							<ul className="aih-risk-list" data-testid="popover-risk">
								{policy.riskReasons.map((reason) => (
									<li key={reason}>
										<span aria-hidden="true" className="codicon codicon-warning" />
										<Text as="span" variant="label">
											Risky: {reason}
										</Text>
									</li>
								))}
							</ul>
						)}
						{policy.mcpLabel !== "" && (
							<Text as="p" className="mb-2" muted variant="caption">
								{policy.mcpLabel}
							</Text>
						)}
						<div data-testid="popover-disclaimer">
							<Text as="p" className="mb-2" muted variant="caption">
								{CLAIM_DISCLAIMER}
							</Text>
						</div>
					</div>
				}
				isVisible={open}
				NOTIFICATIONS_SETTING={NOTIFICATIONS_SETTING}
				restoreFocusRef={chipRef}
				setIsVisible={setOpen}
			/>
		</div>
	)
}

export default ComposerStatus
