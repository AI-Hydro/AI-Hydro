import { useMemo, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { Text } from "@/design"
import AutoApproveModal from "../auto-approve-menu/AutoApproveModal"
import { ACTION_METADATA, NOTIFICATIONS_SETTING } from "../auto-approve-menu/constants"
import { deriveAutoRunPolicy } from "./autoRunPolicy"
import { ContextRing } from "./ContextRing"

/**
 * Owner decision O2 (always-visible line vs popover only) is pending sign-off, so the disclaimer stays visible
 * here AND heads the popover. Do not remove either without that sign-off.
 */
export const CLAIM_DISCLAIMER =
	"Does not approve claims. Claim approval is a signed step you perform in a terminal (aihydro-approve)."

interface ComposerStatusProps {
	/** Per-request context tokens (`lastApiReqTotalTokens`, same source as the task header's context bar). */
	contextTokens?: number
	contextWindow?: number
}

/**
 * The composer's single status footer: the auto-run policy chip (with a text + icon risk marker), the context
 * ring, and the claim disclaimer. Replaces the three-line "Tool auto-run" bar. The chip opens the existing
 * auto-run settings content as a popover.
 */
export function ComposerStatus({ contextTokens, contextWindow }: ComposerStatusProps) {
	const { autoApprovalSettings, mcpServers, yoloModeToggled } = useExtensionState()
	const [open, setOpen] = useState(false)
	const rowRef = useRef<HTMLDivElement>(null)
	const chipRef = useRef<HTMLButtonElement>(null)
	const policy = useMemo(
		() => deriveAutoRunPolicy(autoApprovalSettings, mcpServers, !!yoloModeToggled),
		[autoApprovalSettings, mcpServers, yoloModeToggled],
	)

	// Count of MCP tools is part of the visible chip text so it is never colour- or tooltip-only.
	const showMcpCount = policy.mcpLabel !== ""
	return (
		<div className="px-[15px] pb-[6px] select-none" data-testid="composer-status">
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1" ref={rowRef}>
				<button
					aria-expanded={open}
					aria-haspopup="dialog"
					aria-label={`${policy.summary}. Opens tool auto-run settings.`}
					className="inline-flex flex-wrap items-center gap-x-1 py-0.5 min-h-[24px] px-2 rounded-[10px] text-[11px] cursor-pointer border border-[var(--vscode-editorGroup-border)] bg-transparent text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] max-w-full"
					data-testid="auto-run-chip"
					onClick={() => setOpen((v) => !v)}
					ref={chipRef}
					type="button">
					<span className="min-w-0 text-left">{policy.chipText}</span>
					{policy.risky && (
						<span
							className="inline-flex items-center gap-0.5 shrink-0"
							data-testid="auto-run-risk"
							style={{ color: "var(--vscode-editorWarning-foreground)" }}>
							<span aria-hidden="true" className="codicon codicon-warning text-[12px]" />
							<span>(risky)</span>
						</span>
					)}
					{showMcpCount && (
						<span className="shrink-0 text-[var(--vscode-descriptionForeground)]">{policy.mcpLabel}</span>
					)}
					<span aria-hidden="true" className={`codicon codicon-chevron-${open ? "down" : "up"} text-[12px] shrink-0`} />
				</button>
				<span className="ml-auto">
					<ContextRing contextWindow={contextWindow} used={contextTokens} />
				</span>
			</div>
			<Text as="p" className="pt-[2px]" muted variant="caption">
				{CLAIM_DISCLAIMER}
			</Text>
			<AutoApproveModal
				ACTION_METADATA={ACTION_METADATA}
				buttonRef={rowRef}
				header={
					<div data-testid="popover-disclaimer">
						<Text as="p" className="mb-2" muted variant="caption">
							{CLAIM_DISCLAIMER}
						</Text>
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
