import { alwaysAllowVerdict } from "@shared/aihydro/alwaysAllowPolicy"
import { deriveCallState } from "@shared/aihydro/askOutcome"
import { isInlineApprovalAsk } from "@shared/aihydro/pendingAsk"
import type { AiHydroAskUseMcpServer, AiHydroMessage } from "@shared/ExtensionMessage"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { getButtonConfig } from "../chat-view/shared/buttonConfig"
import { mcpGrantInactiveReason } from "../composer/autoRunPolicy"
import { describeCall } from "../transcript/ToolSummaryLine"
import { usePendingAsk } from "./PendingAskContext"

export const INLINE_APPROVAL_TESTID = "inline-approval"

/** Where a saved "Always" is undone. One sentence, shown on the card after the grant is saved. */
export const ALWAYS_REVOKE_NOTE = "Revoke it any time in MCP settings."

const BUTTON =
	"inline-flex items-center justify-center min-h-[26px] min-w-[24px] px-3 rounded-sm border cursor-pointer text-[12px] disabled:opacity-50 disabled:cursor-not-allowed"
const PRIMARY = `${BUTTON} border-transparent bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)]`
const SECONDARY = `${BUTTON} border-[var(--vscode-button-border,transparent)] bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)]`
const TERTIARY = `${BUTTON} border-[var(--vscode-editorGroup-border)] bg-transparent text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)]`

/** The one MCP tool this ask is about, when "Always" could apply (use_mcp_tool only; never a resource read). */
function mcpToolOf(message: AiHydroMessage): { serverName: string; toolName: string } | undefined {
	if (message.ask !== "use_mcp_server") {
		return undefined
	}
	try {
		const call = JSON.parse(message.text || "{}") as AiHydroAskUseMcpServer
		return call.type === "use_mcp_tool" && call.serverName && call.toolName
			? { serverName: call.serverName, toolName: call.toolName }
			: undefined
	} catch {
		return undefined
	}
}

/**
 * Run / Deny (and "Always" where eligible) on the card that is asking. It answers with its OWN card's ts, through the
 * same executeButtonAction -> askResponse path the footer used, so the host can tell when the ask has moved on.
 *
 * Labels and actions come from getButtonConfig (the single source of truth). The group is never focused
 * automatically and holds no key handlers; the "Focus pending prompt" command focuses the group itself, not a button.
 */
export function InlineApproval({ message }: { message: AiHydroMessage }) {
	const api = usePendingAsk()
	const { mcpServers, autoApprovalSettings, yoloModeToggled, aihydroMessages } = useExtensionState()
	const [note, setNote] = useState<{ kind: "error" | "info"; text: string } | undefined>()
	const groupRef = useRef<HTMLDivElement>(null)
	const restoreFocus = useRef(false)
	const noteId = useId()
	const hintId = useId()
	const inactiveId = useId()

	const visible = isInlineApprovalAsk(message) && deriveCallState(message, aihydroMessages ?? []) === "pending"

	// Focus returns to the composer when an inline answer removes the group the user was in; otherwise it is left alone.
	useEffect(() => {
		if (!visible && restoreFocus.current) {
			restoreFocus.current = false
			api?.focusComposer()
		}
	}, [visible, api])

	const config = useMemo(() => getButtonConfig(message), [message])
	const mcp = useMemo(() => mcpToolOf(message), [message])
	const eligibleAlways = useMemo(() => {
		if (!mcp || message.policyClass || message.isOperationOutsideWorkspace) {
			return false
		}
		const server = (mcpServers ?? []).find((s) => s.name === mcp.serverName)
		if (!server || server.disabled) {
			return false
		}
		const tool = server.tools?.find((t) => t.name === mcp.toolName)
		if (!tool || tool.autoApprove === true) {
			return false
		}
		// The host's verdict reaches the webview as `trust`; the host re-checks and stays the authority.
		return alwaysAllowVerdict({
			serverTrusted: server.trust?.trusted === true,
			serverConnected: server.status === "connected",
			tools: server.tools,
			toolName: mcp.toolName,
		}).ok
	}, [mcp, message.policyClass, message.isOperationOutsideWorkspace, mcpServers])

	const noteEl = note && (
		<div
			className={`text-[12px] ${note.kind === "error" ? "text-[var(--vscode-errorForeground)]" : "text-[var(--vscode-descriptionForeground)]"}`}
			data-testid="inline-approval-note"
			id={noteId}
			role={note.kind === "error" ? "alert" : "status"}>
			{note.text}
		</div>
	)

	if (!api || !config.primaryText || !config.secondaryText) {
		return null
	}
	// Answered: the buttons are gone, but a saved "Always" keeps saying where to revoke it.
	if (!visible) {
		return note?.kind === "info" ? <div className="pt-[6px]">{noteEl}</div> : null
	}

	const inactive = eligibleAlways ? mcpGrantInactiveReason(autoApprovalSettings, !!yoloModeToggled) : undefined
	const busy = api.busyTs === message.ts
	const name = describeCall(message, []).name

	const rememberFocus = () => {
		restoreFocus.current = !!groupRef.current && groupRef.current.contains(document.activeElement)
	}
	const answer = (action: "approve" | "reject") => {
		rememberFocus()
		setNote(undefined)
		void api.respond(message.ts, action)
	}
	const always = async () => {
		if (!mcp) {
			return
		}
		rememberFocus()
		setNote(undefined)
		const result = await api.alwaysAllow({ askTs: message.ts, ...mcp })
		if (result.ok) {
			setNote({ kind: "info", text: `Always allowed ${mcp.toolName}. ${ALWAYS_REVOKE_NOTE}` })
		} else {
			restoreFocus.current = false
			if (result.message) {
				setNote({ kind: "error", text: result.message })
			}
		}
	}

	const describedBy = [api.draftHasContent ? hintId : undefined, note ? noteId : undefined].filter(Boolean).join(" ")

	return (
		<div
			aria-describedby={describedBy || undefined}
			aria-label={`Approval needed: ${name}`}
			className="flex flex-col gap-[6px] pt-[8px] outline-offset-2"
			data-testid={INLINE_APPROVAL_TESTID}
			ref={groupRef}
			role="group"
			tabIndex={-1}>
			<div className="flex flex-wrap items-center gap-[6px]">
				<button
					className={PRIMARY}
					data-testid="inline-approval-primary"
					disabled={busy}
					onClick={() => answer(config.primaryAction === "reject" ? "reject" : "approve")}
					type="button">
					{config.primaryText}
				</button>
				{eligibleAlways && mcp && (
					<button
						aria-describedby={inactive ? inactiveId : undefined}
						aria-label={`Always run ${mcp.toolName} on ${mcp.serverName}`}
						className={TERTIARY}
						data-testid="inline-approval-always"
						disabled={busy}
						onClick={always}
						type="button">
						Always
					</button>
				)}
				<button
					className={SECONDARY}
					data-testid="inline-approval-deny"
					disabled={busy}
					onClick={() => answer(config.secondaryAction === "approve" ? "approve" : "reject")}
					type="button">
					{config.secondaryText}
				</button>
			</div>
			{inactive && (
				<div
					className="text-[12px] text-[var(--vscode-descriptionForeground)]"
					data-testid="inline-approval-inactive"
					id={inactiveId}>
					Always is {inactive}
				</div>
			)}
			{api.draftHasContent && (
				<div
					className="text-[12px] text-[var(--vscode-descriptionForeground)]"
					data-testid="inline-approval-draft-hint"
					id={hintId}>
					Your draft will be sent with your choice.
				</div>
			)}
			{api.askNotice && (
				<div className="text-[12px] text-[var(--vscode-editorWarning-foreground)]" data-testid="inline-approval-stale">
					{api.askNotice}
				</div>
			)}
			{noteEl}
		</div>
	)
}
