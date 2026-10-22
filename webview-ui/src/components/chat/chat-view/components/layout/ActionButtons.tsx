import { deriveCallState } from "@shared/aihydro/askOutcome"
import { isInlineApprovalAsk } from "@shared/aihydro/pendingAsk"
import type { AiHydroMessage } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import type React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { VirtuosoHandle } from "react-virtuoso"
import { usePendingAsk } from "../../../approval/PendingAskContext"
import { ButtonActionType, getButtonConfig } from "../../shared/buttonConfig"
import type { ChatState, MessageHandlers } from "../../types/chatTypes"

interface ActionButtonsProps {
	task?: AiHydroMessage
	messages: AiHydroMessage[]
	chatState: ChatState
	messageHandlers: MessageHandlers
	mode: Mode
	scrollBehavior: {
		scrollToBottomSmooth: () => void
		disableAutoScrollRef: React.MutableRefObject<boolean>
		showScrollToBottom: boolean
		/** The list is at its end. Absent means yes. Scrolling by keyboard or the scrollbar does not set showScrollToBottom. */
		isAtBottom?: boolean
		virtuosoRef: React.RefObject<VirtuosoHandle>
	}
}

/**
 * Action buttons area (approve/reject, Start New Task, ...). Scroll-to-bottom is a small floating round
 * button above the footer and NEVER replaces the action buttons: a pending ask must stay answerable while
 * the user scrolls up to read.
 */
export const ActionButtons: React.FC<ActionButtonsProps> = ({
	task,
	messages,
	chatState,
	mode,
	messageHandlers,
	scrollBehavior,
}) => {
	const { inputValue, selectedImages, selectedFiles, setSendingDisabled, askNotice } = chatState
	const [isProcessing, setIsProcessing] = useState(false)
	const pendingAsk = usePendingAsk()

	// Memoize last messages to avoid unnecessary recalculations
	const [lastMessage, secondLastMessage] = useMemo(() => {
		const len = messages.length
		return len > 0 ? [messages[len - 1], messages[len - 2]] : [undefined, undefined]
	}, [messages])

	// Memoize button configuration to avoid recalculation on every render
	const buttonConfig = useMemo(() => {
		return lastMessage ? getButtonConfig(lastMessage, mode) : { sendingDisabled: false, enableButtons: false }
	}, [lastMessage, mode])

	// Single effect to handle all configuration updates
	useEffect(() => {
		setSendingDisabled(buttonConfig.sendingDisabled)
		setIsProcessing(false)
	}, [buttonConfig, setSendingDisabled])

	// A response dropped as stale leaves the buttons unchanged: let the user act on the new request.
	useEffect(() => {
		if (askNotice) {
			setIsProcessing(false)
		}
	}, [askNotice])

	// Clear input when transitioning from command_output to api_req
	// This happens when user provides feedback during command execution
	useEffect(() => {
		if (lastMessage?.type === "say" && lastMessage.say === "api_req_started" && secondLastMessage?.ask === "command_output") {
			chatState.setInputValue("")
			chatState.setSelectedImages([])
			chatState.setSelectedFiles([])
		}
	}, [lastMessage?.type, lastMessage?.say, secondLastMessage?.ask, chatState])

	const handleActionClick = useCallback(
		(action: ButtonActionType, text?: string, images?: string[], files?: string[]) => {
			if (isProcessing) {
				return
			}
			setIsProcessing(true)
			messageHandlers.executeButtonAction(action, text, images, files)
		},
		[messageHandlers, isProcessing],
	)

	// Esc-to-stop is bound on the prompt (ChatTextArea `onEscape`), never on `window`: a window-wide listener
	// cancelled a running task from any focus, including while the user was in a dialog or another control.

	if (!task) {
		return null
	}

	const { showScrollToBottom, scrollToBottomSmooth, disableAutoScrollRef, isAtBottom = true } = scrollBehavior
	const handleScrollToBottom = () => {
		scrollToBottomSmooth()
		disableAutoScrollRef.current = false
	}

	// Run / Deny for a tool, command, MCP or browser ask live on the card that asks (InlineApproval), so the footer
	// shows none of them. Every other ask, and any ask kind we do not know, keeps its footer buttons.
	const inlineApproval = isInlineApprovalAsk(lastMessage)
	const approvalWaiting = inlineApproval && !!lastMessage && deriveCallState(lastMessage, messages) === "pending"
	const { primaryText, secondaryText, primaryAction, secondaryAction, enableButtons } = buttonConfig
	const hasButtons = !inlineApproval && (primaryText || secondaryText)
	const isStreaming = task.partial === true
	const canInteract = enableButtons && !isProcessing

	const opacity = canInteract || isStreaming ? 1 : 0.5

	// While an approval waits on its card, the scroll button says so: the card (and its buttons) may be out of view,
	// and the label tells the user why scrolling down matters. It scrolls only; it never answers the ask.
	const scrollButton =
		approvalWaiting && !isAtBottom ? (
			<button
				aria-label="Approval waiting, scroll to it"
				className="absolute right-[15px] bottom-full mb-[6px] z-10 flex items-center gap-[4px] h-6 px-[10px] rounded-full border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)] text-[12px] cursor-pointer hover:bg-[var(--vscode-toolbar-hoverBackground)] shadow-sm"
				data-testid="approval-waiting-pill"
				onClick={handleScrollToBottom}
				type="button">
				Approval waiting <span aria-hidden="true">↓</span>
			</button>
		) : showScrollToBottom && !approvalWaiting ? (
			<button
				aria-label="Scroll to bottom"
				className="absolute right-[15px] bottom-full mb-[6px] z-10 flex items-center justify-center w-6 h-6 rounded-full border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)] cursor-pointer p-0 hover:bg-[var(--vscode-toolbar-hoverBackground)] shadow-sm"
				onClick={handleScrollToBottom}
				title="Scroll to bottom"
				type="button">
				<span aria-hidden="true" className="codicon codicon-chevron-down text-[14px]" />
			</button>
		) : null

	// Always mounted so assistive tech announces the text change; empty when there is no notice.
	const notice = (
		<div
			aria-live="polite"
			className={
				askNotice && !inlineApproval
					? "px-[15px] pb-[6px] text-[12px] text-[var(--vscode-editorWarning-foreground)]"
					: "sr-only"
			}
			data-testid="ask-notice"
			role="status">
			{askNotice ?? ""}
		</div>
	)

	// A saved "Always" says where to revoke it here: the card it came from is folded into a work group by then.
	const grantNote = pendingAsk?.grantNote ? (
		<div
			className="flex items-center gap-[8px] px-[15px] pb-[6px] text-[12px] text-[var(--vscode-descriptionForeground)]"
			data-testid="grant-note"
			role="status">
			<span>{pendingAsk.grantNote.text}</span>
			<button
				aria-label="Dismiss note"
				className="inline-flex items-center justify-center min-h-[24px] min-w-[24px] cursor-pointer border-0 bg-transparent text-[var(--vscode-foreground)]"
				onClick={pendingAsk.dismissGrantNote}
				type="button">
				<span aria-hidden="true" className="codicon codicon-close" />
			</button>
		</div>
	) : null

	if (!hasButtons) {
		return (
			<>
				{notice}
				{grantNote}
				{scrollButton ? <div className="relative h-0">{scrollButton}</div> : null}
			</>
		)
	}

	return (
		<>
			{notice}
			{grantNote}
			<div
				aria-label="Pending request actions"
				className="relative flex px-[15px]"
				data-testid="footer-actions"
				role="group"
				style={{ opacity }}
				tabIndex={-1}>
				{scrollButton}
				{primaryText && primaryAction && (
					<VSCodeButton
						appearance="primary"
						className={secondaryText ? "flex-1 mr-[6px]" : "flex-[2]"}
						disabled={!canInteract}
						onClick={() => handleActionClick(primaryAction, inputValue, selectedImages, selectedFiles)}>
						{primaryText}
					</VSCodeButton>
				)}
				{secondaryText && secondaryAction && (
					<VSCodeButton
						appearance="secondary"
						className={primaryText ? "flex-1" : "flex-[2]"}
						disabled={!canInteract}
						onClick={() => handleActionClick(secondaryAction, inputValue, selectedImages, selectedFiles)}>
						{secondaryText}
					</VSCodeButton>
				)}
			</div>
		</>
	)
}
