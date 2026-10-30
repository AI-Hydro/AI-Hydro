import { useMemo, useRef, useState } from "react"
import { TrustLauncherButton } from "@/components/tools/TrustLauncherButton"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { Text } from "@/design"
import AutoApproveModal from "../auto-approve-menu/AutoApproveModal"
import { ACTION_METADATA, NOTIFICATIONS_SETTING } from "../auto-approve-menu/constants"
import { deriveAutoRunPolicy, pausedGroupText } from "./autoRunPolicy"
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

/** Tool names listed per group before "and N more" (the full list is the group's title). */
const MAX_NAMES = 8

function namesText(tools: string[]): string {
	return tools.length <= MAX_NAMES
		? tools.join(", ")
		: `${tools.slice(0, MAX_NAMES).join(", ")} and ${tools.length - MAX_NAMES} more`
}

interface ComposerStatusProps {
	/** Per-request context tokens (`lastApiReqTotalTokens`, same source as the task header's context bar). */
	contextTokens?: number
	contextWindow?: number
}

/**
 * The composer's single status row (one line, 24 px chips): the auto-run chip, a count chip for paused MCP grants
 * (only when there are any; "N ask first" when they all ask by design, "N paused" when something can be fixed), and the context ring. Each chip opens a popover. A risky setting stays visible at rest as
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
	// "Paused" says something stopped that you can restart. When every tool asks by design (destructive, third-party)
	// nothing is wrong and nothing is stopped, so the chip says what happens: they ask first.
	const needsAction = policy.mcpPausedNeedsAction
	const pausedChipText = needsAction ? `${policy.mcpPaused} paused` : `${policy.mcpPaused} ask first`
	const pausedName = needsAction
		? `${policy.mcpPaused} MCP ${toolNoun(policy.mcpPaused)} paused, asks first`
		: `${policy.mcpPaused} MCP ${toolNoun(policy.mcpPaused)} ${policy.mcpPaused === 1 ? "asks" : "ask"} first`

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
					className={`aih-chip${needsAction ? " aih-chip--warn" : ""}`}
					data-testid="paused-chip"
					onClick={() => {
						setOpen(false)
						setPausedOpen((v) => !v)
					}}
					ref={pausedRef}
					title={pausedName}
					type="button">
					<span className="aih-chip__label">{pausedChipText}</span>
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
					{needsAction
						? "These tools have an Always allow grant that is not in effect right now, so each one asks before it runs. Nothing here runs without you."
						: "These tools have an Always allow grant, but AI-Hydro keeps them on ask by design. Nothing here runs without you, and there is nothing to fix."}
				</p>
				<ul className="aih-popover__list" data-testid="paused-groups">
					{policy.mcpPausedGroups.map((g) => (
						<li data-testid="paused-group" key={`${g.server}\u0000${g.reason}`}>
							<strong>{g.server}</strong>: <span title={g.tools.join(", ")}>{namesText(g.tools)}</span>
							{" \u2014 "}
							{pausedGroupText(g)}
							{/* The host-owned action: a modal showing the exact command; it records trust only if you confirm there. */}
							{g.trustFixable && (
								<div className="mt-1">
									<p className="aih-popover__body" data-testid="trust-launcher-explain">
										Opens a confirmation showing the exact command that starts {g.server}. Nothing is trusted
										unless you confirm it there.
									</p>
									<TrustLauncherButton
										ariaLabel={`Trust this launcher for ${g.server}`}
										className="aih-menu-item"
										serverName={g.server}
										testId="trust-launcher-action"
									/>
								</div>
							)}
						</li>
					))}
				</ul>
				{needsAction && (
					<p className="aih-popover__body">
						To lift a pause, check that the server is connected and shows Trusted in Hydro Tools &amp; Data Sources.
					</p>
				)}
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
						{/* The active MCP grants are already a "Risky:" line above; only the paused part is new here. */}
						{policy.mcpPausedLabel !== "" && (
							<Text as="p" className="mb-2" muted variant="caption">
								{policy.mcpPausedLabel}
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
