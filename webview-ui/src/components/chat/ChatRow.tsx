import { type CallState, deriveCallState } from "@shared/aihydro/askOutcome"
import { isElevatedMcpLevel } from "@shared/aihydro/infoNotice"
import { getPairing, isScienceServer } from "@shared/aihydro/toolCallPresenter"
import { COMMAND_OUTPUT_STRING, COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import {
	AiHydroApiReqInfo,
	AiHydroAskQuestion,
	AiHydroAskUseMcpServer,
	AiHydroMessage,
	AiHydroPlanModeResponse,
	AiHydroSayTool,
	COMPLETION_RESULT_CHANGES_FLAG,
} from "@shared/ExtensionMessage"
import { BooleanRequest, Int64Request, StringRequest } from "@shared/proto/cline/common"
import { VSCodeBadge, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import deepEqual from "fast-deep-equal"
import React, { MouseEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSize } from "react-use"
import styled from "styled-components"
import { OptionsButtons } from "@/components/chat/OptionsButtons"
import TaskFeedbackButtons from "@/components/chat/TaskFeedbackButtons"
import { CheckmarkControl } from "@/components/common/CheckmarkControl"
import CodeBlock, {
	CHAT_ROW_EXPANDED_BG_COLOR,
	CODE_BLOCK_BG_COLOR,
	TERMINAL_CODE_BLOCK_BG_COLOR,
} from "@/components/common/CodeBlock"
import { WithCopyButton } from "@/components/common/CopyButton"
import MarkdownBlock from "@/components/common/MarkdownBlock"
import HtmlPreviewView from "@/components/html_preview/HtmlPreviewView"
import McpResponseDisplay from "@/components/mcp/chat-display/McpResponseDisplay"
import McpResourceRow from "@/components/mcp/configuration/tabs/installed/server-row/McpResourceRow"
import McpToolRow from "@/components/mcp/configuration/tabs/installed/server-row/McpToolRow"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useHtmlPreviewContext } from "@/context/HtmlPreviewContext"
import { FileServiceClient, TaskServiceClient, UiServiceClient } from "@/services/grpc-client"
import { findMatchingResourceOrTemplate, getMcpServerDisplayName } from "@/utils/mcp"
import { CheckpointControls } from "../common/CheckpointControls"
import CodeAccordian, { cleanPathPrefix } from "../common/CodeAccordian"
import { AnswerAuditSummary } from "./AnswerAuditSummary"
import { AnswerBlock, type AnswerExtras } from "./answer/AnswerBlock"
import { InlineApproval } from "./approval/InlineApproval"
import { ErrorBlockTitle } from "./ErrorBlockTitle"
import ErrorRow from "./ErrorRow"
import { MutedNotice } from "./MutedNotice"
import NewTaskPreview from "./NewTaskPreview"
import QuoteButton from "./QuoteButton"
import ReportBugPreview from "./ReportBugPreview"
import ScienceToolCard from "./ScienceToolCard"
import SearchResultsDisplay from "./SearchResultsDisplay"
import UserMessage from "./UserMessage"

const normalColor = "var(--vscode-foreground)"
const errorColor = "var(--vscode-errorForeground)"
const _cancelledColor = "var(--vscode-descriptionForeground)"

/**
 * Header wording for a call, by what the stream shows happened to it (askOutcome.ts). Past tense only with
 * execution evidence; "Approved" is not "ran"; a denied call is said to be not run; with no evidence the row only
 * says the agent asked. `tail` ends the phrase (":" by default, "" when more text follows in the same header).
 */
function askText(state: CallState, noun: string, past: string, tail = ":"): string {
	switch (state) {
		case "pending":
			return `AI-Hydro wants to ${noun}${tail}`
		case "approved":
			return `Approved: ${noun}${tail}`
		case "running":
			return `Running: ${noun}…${tail === ":" ? "" : tail}`
		case "executed":
			return `AI-Hydro ${past}${tail}`
		case "failed":
			return `Failed: ${noun}${tail}`
		case "denied":
			return tail === ":" ? `Denied: ${noun} (not run)` : `Denied: ${noun}`
		default:
			return `AI-Hydro asked to ${noun}${tail}`
	}
}

const ChatRowContainer = styled.div`
	padding: 10px 6px 6px 15px;
	position: relative;

	&:hover ${CheckpointControls} {
		opacity: 1;
	}
`

const TimestampLabel = styled.div`
	font-size: 10px;
	font-weight: 500;
	color: var(--vscode-descriptionForeground);
	opacity: 0;
	transition: opacity 0.1s ease-out;
	margin-top: 4px;
	letter-spacing: 0.03em;
	text-transform: uppercase;

	${ChatRowContainer}:hover & {
		opacity: 0.65;
	}
`

interface ChatRowProps {
	message: AiHydroMessage
	isExpanded: boolean
	onToggleExpand: (ts: number) => void
	lastModifiedMessage?: AiHydroMessage
	isLast: boolean
	onHeightChange: (isTaller: boolean) => void
	inputValue?: string
	sendMessageFromChatRow?: (text: string, images: string[], files: string[]) => void
	onSetQuote: (text: string) => void
	onCancelCommand?: () => void
	/** Answer card extras from the transcript presenter (completion rows only). */
	answer?: AnswerExtras
}

interface QuoteButtonState {
	visible: boolean
	top: number
	left: number
	selectedText: string
}

interface ChatRowContentProps extends Omit<ChatRowProps, "onHeightChange"> {}

export const ProgressIndicator = () => (
	<div
		style={{
			width: "16px",
			height: "16px",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
		}}>
		<div style={{ transform: "scale(0.55)", transformOrigin: "center" }}>
			<VSCodeProgressRing />
		</div>
	</div>
)

// ─── Tool message card wrapper ──────────────────────────────────────────────

const getToolAccentClass = (toolName: string): string => {
	switch (toolName) {
		case "editedExistingFile":
			return "tool-accent-file"
		case "newFileCreated":
			return "tool-accent-file"
		case "readFile":
			return "tool-accent-file"
		case "listFilesTopLevel":
			return "tool-accent-list"
		case "listFilesRecursive":
			return "tool-accent-list"
		case "listCodeDefinitionNames":
			return "tool-accent-list"
		case "searchFiles":
			return "tool-accent-search"
		case "webFetch":
			return "tool-accent-web"
		case "summarizeTask":
			return "tool-accent-process"
		default:
			return ""
	}
}

interface ToolMessageCardProps {
	toolName: string
	children: React.ReactNode
}

const ToolMessageCard: React.FC<ToolMessageCardProps> = ({ toolName, children }) => {
	const accentClass = getToolAccentClass(toolName)
	return <div className={`tool-message-card${accentClass ? ` ${accentClass}` : ""}`}>{children}</div>
}

// ──────────────────────────────────────────────────────────────────────────────

const Markdown = memo(({ markdown }: { markdown?: string }) => {
	return (
		<div
			style={{
				wordBreak: "break-word",
				overflowWrap: "anywhere",
				marginBottom: -15,
				marginTop: -15,
				overflow: "hidden", // contain child margins so that parent diff matches height of children
			}}>
			<MarkdownBlock markdown={markdown} />
		</div>
	)
})

const CommandOutput = memo(
	({
		output,
		isOutputFullyExpanded,
		onToggle,
		isContainerExpanded,
	}: {
		output: string
		isOutputFullyExpanded: boolean
		onToggle: () => void
		isContainerExpanded: boolean
	}) => {
		const outputLines = output.split("\n")
		const lineCount = outputLines.length
		const shouldAutoShow = lineCount <= 5
		const outputRef = useRef<HTMLDivElement>(null)

		// Auto-scroll to bottom when output changes (only when showing limited output)
		useEffect(() => {
			if (!isOutputFullyExpanded && outputRef.current) {
				// Direct scrollTop manipulation
				outputRef.current.scrollTop = outputRef.current.scrollHeight

				// Another attempt with more delay (for slower renders) to ensure scrolling works
				setTimeout(() => {
					if (outputRef.current) {
						outputRef.current.scrollTop = outputRef.current.scrollHeight
					}
				}, 50)
			}
		}, [output, isOutputFullyExpanded])

		// Don't render anything if container is collapsed
		if (!isContainerExpanded) {
			return null
		}

		return (
			<div
				style={{
					width: "100%",
					position: "relative",
					paddingBottom: lineCount > 5 ? "16px" : "0",
					overflow: "visible",
					borderTop: "1px solid var(--ai-hydro-border, rgba(51, 65, 85, 0.7))",
					backgroundColor: TERMINAL_CODE_BLOCK_BG_COLOR,
					borderBottomLeftRadius: "6px",
					borderBottomRightRadius: "6px",
				}}>
				<div
					ref={outputRef}
					style={{
						color: "#FFFFFF",
						maxHeight: shouldAutoShow ? "none" : isOutputFullyExpanded ? "360px" : "75px",
						overflowY: shouldAutoShow ? "visible" : "auto",
						scrollBehavior: "smooth",
						backgroundColor: TERMINAL_CODE_BLOCK_BG_COLOR,
					}}>
					<div style={{ backgroundColor: TERMINAL_CODE_BLOCK_BG_COLOR }}>
						<CodeBlock forceWrap={true} source={`${"```"}shell\n${output}\n${"```"}`} />
					</div>
				</div>
				{/* Show notch only if there's more than 5 lines */}
				{lineCount > 5 && (
					<div
						onClick={onToggle}
						onMouseEnter={(e) => {
							e.currentTarget.style.opacity = "0.8"
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.opacity = "1"
						}}
						style={{
							position: "absolute",
							bottom: "-10px",
							left: "50%",
							transform: "translateX(-50%)",
							display: "flex",
							justifyContent: "center",
							alignItems: "center",
							padding: "1px 14px",
							cursor: "pointer",
							backgroundColor: "var(--vscode-descriptionForeground)",
							borderRadius: "3px 3px 6px 6px",
							transition: "opacity 0.1s ease",
							border: "1px solid rgba(0, 0, 0, 0.1)",
						}}>
						<span
							className={`codicon codicon-triangle-${isOutputFullyExpanded ? "up" : "down"}`}
							style={{
								fontSize: "11px",
								color: "var(--vscode-editor-background)",
							}}
						/>
					</div>
				)}
			</div>
		)
	},
)

const ChatRow = memo(
	(props: ChatRowProps) => {
		const { isLast, onHeightChange, message } = props
		// Store the previous height to compare with the current height
		// This allows us to detect changes without causing re-renders
		const prevHeightRef = useRef(0)

		const formatMessageTime = (ts: number) => {
			const date = new Date(ts)
			const now = new Date()
			const isToday = date.toDateString() === now.toDateString()
			if (isToday) {
				return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
			}
			return date.toLocaleString("en-US", {
				month: "short",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
				hour12: true,
			})
		}

		const [chatrow, { height }] = useSize(
			<ChatRowContainer>
				<ChatRowContent {...props} />
				<InlineApproval message={message} />
				<TimestampLabel>{formatMessageTime(message.ts)}</TimestampLabel>
			</ChatRowContainer>,
		)

		useEffect(() => {
			// used for partials command output etc.
			// NOTE: it's important we don't distinguish between partial or complete here since our scroll effects in chatview need to handle height change during partial -> complete
			const isInitialRender = prevHeightRef.current === 0 // prevents scrolling when new element is added since we already scroll for that
			// height starts off at Infinity
			if (isLast && height !== 0 && height !== Infinity && height !== prevHeightRef.current) {
				if (!isInitialRender) {
					onHeightChange(height > prevHeightRef.current)
				}
				prevHeightRef.current = height
			}
		}, [height, isLast, onHeightChange, message])

		// we cannot return null as virtuoso does not support it so we use a separate visibleMessages array to filter out messages that should not be rendered
		return chatrow
	},
	// memo does shallow comparison of props, so we need to do deep comparison of arrays/objects whose properties might change
	deepEqual,
)

export default ChatRow

export const ChatRowContent = memo(
	({
		message,
		isExpanded,
		onToggleExpand,
		lastModifiedMessage,
		isLast,
		inputValue,
		sendMessageFromChatRow,
		onSetQuote,
		onCancelCommand,
		answer,
	}: ChatRowContentProps) => {
		const { mcpServers, mcpMarketplaceCatalog, onRelinquishControl, vscodeTerminalExecutionMode, aihydroMessages } =
			useExtensionState()
		const { items: htmlPreviewItems } = useHtmlPreviewContext()
		const [seeNewChangesDisabled, setSeeNewChangesDisabled] = useState(false)
		const [quoteButtonState, setQuoteButtonState] = useState<QuoteButtonState>({
			visible: false,
			top: 0,
			left: 0,
			selectedText: "",
		})
		const contentRef = useRef<HTMLDivElement>(null)

		// Command output expansion state (for all messages, but only used by command messages)
		const [isOutputFullyExpanded, setIsOutputFullyExpanded] = useState(false)
		// Long shell commands collapse to a one-line summary by default to keep the chat compact.
		const [isCommandExpanded, setIsCommandExpanded] = useState(false)
		const prevCommandExecutingRef = useRef<boolean>(false)
		const [cost, apiReqCancelReason, apiReqStreamingFailedMessage, retryStatus, costStatus] = useMemo(() => {
			if (message.text != null && message.say === "api_req_started") {
				const info: AiHydroApiReqInfo = JSON.parse(message.text)
				return [info.cost, info.cancelReason, info.streamingFailedMessage, info.retryStatus, info.costStatus]
			}
			return [undefined, undefined, undefined, undefined, undefined]
		}, [message.text, message.say])

		// when resuming task last won't be api_req_failed but a resume_task message so api_req_started will show loading spinner. that's why we just remove the last api_req_started that failed without streaming anything
		const apiRequestFailedMessage =
			isLast && lastModifiedMessage?.ask === "api_req_failed" // if request is retried then the latest message is a api_req_retried
				? lastModifiedMessage?.text
				: undefined

		const isCommandMessage = message.ask === "command" || message.say === "command"
		// Check if command has output to determine if it's actually executing
		const commandHasOutput = message.text?.includes(COMMAND_OUTPUT_STRING) ?? false
		// A command is executing if it has output but hasn't completed yet
		const isCommandExecuting = isCommandMessage && !message.commandCompleted && commandHasOutput
		// A command is pending if it hasn't started (no output) and hasn't completed
		const isCommandPending = isCommandMessage && isLast && !message.commandCompleted && !commandHasOutput
		const isCommandCompleted = isCommandMessage && message.commandCompleted === true
		// Within the pending state, distinguish "waiting on the user" from "approved and
		// executing but no output yet". The harness renders an approval request as
		// ask==="command" and an already-approved/auto-approved command as say==="command".
		// Collapsing both into a single "Pending" badge made a terminal-acquisition hang
		// (approved, executing, but stalled before any output) look identical to awaiting
		// approval — a real frozen session was misdiagnosed as a permission prompt for hours.
		const isCommandAwaitingApproval = isCommandPending && message.ask === "command"
		const isCommandStarting = isCommandPending && message.say === "command"

		const isMcpServerResponding = isLast && lastModifiedMessage?.say === "mcp_server_request_started"

		const type = message.type === "ask" ? message.ask : message.say

		// "wants to ..." is honest only while the call is awaiting permission. An ask that is no longer the last row
		// has been answered (run or denied), and a `say` is by construction something that already happened.
		// Tense comes from the outcome recorded in the stream (askOutcome.ts), never from row position.
		const askOutcome = useMemo(() => deriveCallState(message, aihydroMessages ?? []), [message, aihydroMessages])
		const isPendingAsk = askOutcome === "pending"

		const handleToggle = useCallback(() => {
			onToggleExpand(message.ts)
		}, [onToggleExpand, message.ts])

		// Use the onRelinquishControl hook instead of message event
		useEffect(() => {
			return onRelinquishControl(() => {
				setSeeNewChangesDisabled(false)
			})
		}, [onRelinquishControl])

		// --- Quote Button Logic ---
		// MOVE handleQuoteClick INSIDE ChatRowContent
		const handleQuoteClick = useCallback(() => {
			onSetQuote(quoteButtonState.selectedText)
			window.getSelection()?.removeAllRanges() // Clear the browser selection
			setQuoteButtonState({ visible: false, top: 0, left: 0, selectedText: "" })
		}, [onSetQuote, quoteButtonState.selectedText]) // <-- Use onSetQuote from props

		const viewCompletionChanges = useCallback(() => {
			setSeeNewChangesDisabled(true)
			TaskServiceClient.taskCompletionViewChanges(Int64Request.create({ value: message.ts })).catch((err) =>
				console.error("Failed to show task completion view changes:", err),
			)
		}, [message.ts])

		const handleMouseUp = useCallback((event: MouseEvent<HTMLDivElement>) => {
			// Get the target element immediately, before the timeout
			const targetElement = event.target as Element
			const isClickOnButton = !!targetElement.closest(".quote-button-class")

			// Delay the selection check slightly
			setTimeout(() => {
				// Now, check the selection state *after* the browser has likely updated it
				const selection = window.getSelection()
				const selectedText = selection?.toString().trim() ?? ""

				let shouldShowButton = false
				let buttonTop = 0
				let buttonLeft = 0
				let textToQuote = ""

				// Condition 1: Check if there's a valid, non-collapsed selection within bounds
				// Ensure contentRef.current still exists in case component unmounted during timeout
				if (selectedText && contentRef.current && selection && selection.rangeCount > 0 && !selection.isCollapsed) {
					const range = selection.getRangeAt(0)
					const rangeRect = range.getBoundingClientRect()
					// Re-check ref inside timeout and ensure containerRect is valid
					const containerRect = contentRef.current?.getBoundingClientRect()

					if (containerRect) {
						// Check if containerRect was successfully obtained
						const tolerance = 5 // Allow for a small pixel overflow (e.g., for margins)
						const isSelectionWithin =
							rangeRect.top >= containerRect.top &&
							rangeRect.left >= containerRect.left &&
							rangeRect.bottom <= containerRect.bottom + tolerance && // Added tolerance
							rangeRect.right <= containerRect.right

						if (isSelectionWithin) {
							shouldShowButton = true // Mark that we should show the button
							const buttonHeight = 30
							// Calculate the raw top position relative to the container, placing it above the selection
							const calculatedTop = rangeRect.top - containerRect.top - buttonHeight - 5 // Subtract button height and a small margin
							// Allow the button to potentially have a negative top value
							buttonTop = calculatedTop
							buttonLeft = Math.max(0, rangeRect.left - containerRect.left) // Still prevent going left of container
							textToQuote = selectedText
						}
					}
				}

				// Decision: Set the state based on whether we should show or hide
				if (shouldShowButton) {
					// Scenario A: Valid selection exists -> Show button
					setQuoteButtonState({
						visible: true,
						top: buttonTop,
						left: buttonLeft,
						selectedText: textToQuote,
					})
				} else if (!isClickOnButton) {
					// Scenario B: No valid selection AND click was NOT on button -> Hide button
					setQuoteButtonState({ visible: false, top: 0, left: 0, selectedText: "" })
				}
				// Scenario C (Click WAS on button): Do nothing here, handleQuoteClick takes over.
			}, 0) // Delay of 0ms pushes execution after current event cycle
		}, []) // Dependencies remain empty

		/** The answer prose with its quote-selection behaviour. Markers render as inline chips where they were cited. */
		const answerBody = (text: string) => (
			<div onMouseUp={handleMouseUp} ref={contentRef} style={{ position: "relative" }}>
				<Markdown markdown={text} />
				{quoteButtonState.visible && (
					<QuoteButton left={quoteButtonState.left} onClick={handleQuoteClick} top={quoteButtonState.top} />
				)}
			</div>
		)

		const [icon, title] = useMemo(() => {
			switch (type) {
				case "error":
					return [
						<span
							className="codicon codicon-error"
							style={{
								color: errorColor,
								marginBottom: "-1.5px",
							}}></span>,
						<span style={{ color: errorColor, fontWeight: "bold" }}>Error</span>,
					]
				case "mistake_limit_reached":
					return [
						<span
							className="codicon codicon-error"
							style={{
								color: errorColor,
								marginBottom: "-1.5px",
							}}></span>,
						<span style={{ color: errorColor, fontWeight: "bold" }}>AI-Hydro is having trouble...</span>,
					]
				case "auto_approval_max_req_reached":
					return [
						<span
							className="codicon codicon-warning"
							style={{
								color: errorColor,
								marginBottom: "-1.5px",
							}}></span>,
						<span style={{ color: errorColor, fontWeight: "bold" }}>Maximum Requests Reached</span>,
					]
				case "command":
					return [
						<span
							className="codicon codicon-terminal"
							style={{
								color: normalColor,
								marginBottom: "-1.5px",
							}}></span>,
						<span style={{ color: normalColor, fontWeight: "bold" }}>
							{askText(askOutcome, "execute this command", "ran this command")}
						</span>,
					]
				case "use_mcp_server":
					const mcpServerUse = JSON.parse(message.text || "{}") as AiHydroAskUseMcpServer
					return [
						isMcpServerResponding ? (
							<ProgressIndicator />
						) : (
							<span
								className="codicon codicon-server"
								style={{
									color: normalColor,
									marginBottom: "-1.5px",
								}}></span>
						),
						<span
							className="ph-no-capture"
							style={{ color: normalColor, fontWeight: "bold", wordBreak: "break-word" }}>
							{mcpServerUse.type === "use_mcp_tool"
								? askText(askOutcome, "use a tool", "used a tool", "")
								: askText(askOutcome, "access a resource", "accessed a resource", "")}{" "}
							on the{" "}
							<code className="break-all">
								{getMcpServerDisplayName(mcpServerUse.serverName, mcpMarketplaceCatalog)}
							</code>{" "}
							MCP server:{askOutcome === "denied" ? " (not run)" : ""}
						</span>,
					]
				case "completion_result":
					// Neutral: finishing a task is not evidence. Green is reserved for an approved claim (evidenceStates).
					return [
						<span
							className="codicon codicon-comment-discussion"
							style={{
								color: normalColor,
								marginBottom: "-1.5px",
							}}></span>,
						<span style={{ color: normalColor, fontWeight: "bold" }}>Answer</span>,
					]
				case "api_req_started":
					return ErrorBlockTitle({
						cost,
						apiReqCancelReason,
						apiRequestFailedMessage,
						retryStatus,
					})
				case "followup":
					return [
						<span
							className="codicon codicon-question"
							style={{
								color: normalColor,
								marginBottom: "-1.5px",
							}}></span>,
						<span style={{ color: normalColor, fontWeight: "bold" }}>AI-Hydro has a question:</span>,
					]
				default:
					return [null, null]
			}
		}, [
			type,
			cost,
			apiRequestFailedMessage,
			isCommandExecuting,
			isCommandPending,
			apiReqCancelReason,
			isMcpServerResponding,
			askOutcome,
			message.text,
		])

		const _pStyle: React.CSSProperties = {
			margin: 0,
			whiteSpace: "pre-wrap",
			wordBreak: "break-word",
			overflowWrap: "anywhere",
		}

		const tool = useMemo(() => {
			if (message.ask === "tool" || message.say === "tool") {
				return JSON.parse(message.text || "{}") as AiHydroSayTool
			}
			return null
		}, [message.ask, message.say, message.text])

		// Helper function to check if file is an image
		const isImageFile = (filePath: string): boolean => {
			const imageExtensions = [".png", ".jpg", ".jpeg", ".webp"]
			const extension = filePath.toLowerCase().split(".").pop()
			return extension ? imageExtensions.includes(`.${extension}`) : false
		}

		if (tool) {
			const colorMap = {
				red: "var(--vscode-errorForeground)",
				yellow: "var(--vscode-editorWarning-foreground)",
			}
			const toolIcon = (name: string, color?: string, rotation?: number, title?: string) => (
				<span
					className={`codicon codicon-${name} ph-no-capture`}
					style={{
						color: color ? colorMap[color as keyof typeof colorMap] || color : "var(--vscode-foreground)",
						marginBottom: "-1.5px",
						transform: rotation ? `rotate(${rotation}deg)` : undefined,
					}}
					title={title}></span>
			)

			switch (tool.tool) {
				case "editedExistingFile":
					return (
						<ToolMessageCard toolName="editedExistingFile">
							<div className="chat-row-header">
								{toolIcon("edit")}
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This file is outside of your workspace")}
								<span className="font-bold">{askText(askOutcome, "edit this file", "edited this file")}</span>
							</div>
							<CodeAccordian
								// isLoading={message.partial}
								code={tool.content}
								isExpanded={isExpanded}
								onToggleExpand={handleToggle}
								path={tool.path!}
							/>
						</ToolMessageCard>
					)
				case "newFileCreated":
					return (
						<ToolMessageCard toolName="newFileCreated">
							<div className="chat-row-header">
								{toolIcon("new-file")}
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This file is outside of your workspace")}
								<span className="font-bold">
									{askText(askOutcome, "create a new file", "created a new file")}
								</span>
							</div>
							<CodeAccordian
								code={tool.content!}
								isExpanded={isExpanded}
								isLoading={message.partial}
								onToggleExpand={handleToggle}
								path={tool.path!}
							/>
						</ToolMessageCard>
					)
				case "readFile":
					const isImage = isImageFile(tool.path || "")
					return (
						<ToolMessageCard toolName="readFile">
							<div className="chat-row-header">
								{toolIcon(isImage ? "file-media" : "file-code")}
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This file is outside of your workspace")}
								<span className="font-bold">{askText(askOutcome, "read this file", "read this file")}</span>
							</div>
							<div
								className="modern-card overflow-hidden"
								style={{
									backgroundColor: CODE_BLOCK_BG_COLOR,
									border: "1px solid var(--ai-hydro-border, var(--vscode-editorGroup-border))",
								}}>
								<div
									onClick={
										isImage
											? undefined
											: () => {
													FileServiceClient.openFile(
														StringRequest.create({ value: tool.content }),
													).catch((err) => console.error("Failed to open file:", err))
												}
									}
									style={{
										color: "var(--vscode-descriptionForeground)",
										display: "flex",
										alignItems: "center",
										padding: "9px 10px",
										cursor: isImage ? "default" : "pointer",
										userSelect: isImage ? "text" : "none",
										WebkitUserSelect: isImage ? "text" : "none",
										MozUserSelect: isImage ? "text" : "none",
										msUserSelect: isImage ? "text" : "none",
									}}>
									{tool.path?.startsWith(".") && <span>.</span>}
									{tool.path && !tool.path.startsWith(".") && <span>/</span>}
									<span
										className="ph-no-capture"
										style={{
											whiteSpace: "nowrap",
											overflow: "hidden",
											textOverflow: "ellipsis",
											marginRight: "8px",
											direction: "rtl",
											textAlign: "left",
										}}>
										{cleanPathPrefix(tool.path ?? "") + "\u200E"}
									</span>
									<div style={{ flexGrow: 1 }}></div>
									{!isImage && (
										<span
											className={`codicon codicon-link-external`}
											style={{
												fontSize: 13.5,
												margin: "1px 0",
											}}></span>
									)}
								</div>
							</div>
						</ToolMessageCard>
					)
				case "listFilesTopLevel":
					return (
						<ToolMessageCard toolName="listFilesTopLevel">
							<div className="chat-row-header">
								{toolIcon("folder-opened")}
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This is outside of your workspace")}
								<span className="font-bold">
									{askText(
										askOutcome,
										"view the top level files in this directory",
										"viewed the top level files in this directory",
									)}
								</span>
							</div>
							<CodeAccordian
								code={tool.content!}
								isExpanded={isExpanded}
								language="shell-session"
								onToggleExpand={handleToggle}
								path={tool.path!}
							/>
						</ToolMessageCard>
					)
				case "listFilesRecursive":
					return (
						<ToolMessageCard toolName="listFilesRecursive">
							<div className="chat-row-header">
								{toolIcon("folder-opened")}
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This is outside of your workspace")}
								<span className="font-bold">
									{askText(
										askOutcome,
										"recursively view all files in this directory",
										"recursively viewed all files in this directory",
									)}
								</span>
							</div>
							<CodeAccordian
								code={tool.content!}
								isExpanded={isExpanded}
								language="shell-session"
								onToggleExpand={handleToggle}
								path={tool.path!}
							/>
						</ToolMessageCard>
					)
				case "listCodeDefinitionNames":
					return (
						<ToolMessageCard toolName="listCodeDefinitionNames">
							<div className="chat-row-header">
								{toolIcon("file-code")}
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This file is outside of your workspace")}
								<span className="font-bold">
									{askText(
										askOutcome,
										"view source code definition names used in this directory",
										"viewed source code definition names used in this directory",
									)}
								</span>
							</div>
							<CodeAccordian
								code={tool.content!}
								isExpanded={isExpanded}
								onToggleExpand={handleToggle}
								path={tool.path!}
							/>
						</ToolMessageCard>
					)
				case "searchFiles":
					return (
						<ToolMessageCard toolName="searchFiles">
							<div className="chat-row-header">
								{toolIcon("search")}
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This is outside of your workspace")}
								<span className="font-bold">
									{askText(askOutcome, "search this directory for", "searched this directory for", "")}{" "}
									<code style={{ wordBreak: "break-all" }}>{tool.regex}</code>:
									{askOutcome === "denied" ? " (not run)" : ""}
								</span>
							</div>
							<SearchResultsDisplay
								content={tool.content!}
								filePattern={tool.filePattern}
								isExpanded={isExpanded}
								onToggleExpand={handleToggle}
								path={tool.path!}
							/>
						</ToolMessageCard>
					)
				case "summarizeTask":
					return (
						<ToolMessageCard toolName="summarizeTask">
							<div className="chat-row-header">
								{toolIcon("book")}
								<span className="font-bold">AI-Hydro is condensing the conversation:</span>
							</div>
							<div
								className="modern-card overflow-hidden"
								style={{
									backgroundColor: CODE_BLOCK_BG_COLOR,
									border: "1px solid var(--vscode-editorGroup-border)",
								}}>
								<div
									onClick={handleToggle}
									style={{
										color: "var(--vscode-descriptionForeground)",
										padding: "9px 10px",
										cursor: "pointer",
										userSelect: "none",
										WebkitUserSelect: "none",
										MozUserSelect: "none",
										msUserSelect: "none",
									}}>
									{isExpanded ? (
										<div>
											<div style={{ display: "flex", alignItems: "center", marginBottom: "8px" }}>
												<span style={{ fontWeight: "bold", marginRight: "4px" }}>Summary:</span>
												<div style={{ flexGrow: 1 }}></div>
												<span
													className="codicon codicon-chevron-up"
													style={{
														fontSize: 13.5,
														margin: "1px 0",
													}}></span>
											</div>
											<span
												className="ph-no-capture"
												style={{
													whiteSpace: "pre-wrap",
													wordBreak: "break-word",
													overflowWrap: "anywhere",
												}}>
												{tool.content}
											</span>
										</div>
									) : (
										<div style={{ display: "flex", alignItems: "center" }}>
											<span
												className="ph-no-capture"
												style={{
													whiteSpace: "nowrap",
													overflow: "hidden",
													textOverflow: "ellipsis",
													marginRight: "8px",
													direction: "rtl",
													textAlign: "left",
													flex: 1,
												}}>
												{tool.content + "\u200E"}
											</span>
											<span
												className="codicon codicon-chevron-down"
												style={{
													fontSize: 13.5,
													margin: "1px 0",
													flexShrink: 0,
												}}></span>
										</div>
									)}
								</div>
							</div>
						</ToolMessageCard>
					)
				case "webFetch":
					return (
						<ToolMessageCard toolName="webFetch">
							<div className="chat-row-header">
								<span
									className="codicon codicon-link"
									style={{ color: normalColor, marginBottom: "-1.5px" }}></span>
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This URL is external")}
								<span className="font-bold">
									{askText(askOutcome, "fetch content from this URL", "fetched content from this URL")}
								</span>
							</div>
							<div
								onClick={() => {
									// Open the URL in the default browser using gRPC
									if (tool.path) {
										UiServiceClient.openUrl(StringRequest.create({ value: tool.path })).catch((err) => {
											console.error("Failed to open URL:", err)
										})
									}
								}}
								style={{
									borderRadius: 3,
									backgroundColor: CODE_BLOCK_BG_COLOR,
									overflow: "hidden",
									border: "1px solid var(--vscode-editorGroup-border)",
									padding: "9px 10px",
									cursor: "pointer",
									userSelect: "none",
									WebkitUserSelect: "none",
									MozUserSelect: "none",
									msUserSelect: "none",
								}}>
								<span
									className="ph-no-capture"
									style={{
										whiteSpace: "nowrap",
										overflow: "hidden",
										textOverflow: "ellipsis",
										marginRight: "8px",
										direction: "rtl",
										textAlign: "left",
										color: "var(--vscode-textLink-foreground)",
										textDecoration: "underline",
									}}>
									{tool.path + "\u200E"}
								</span>
							</div>
							{/* Displaying the 'content' which now holds "Fetching URL: [URL]" */}
							{/* <div style={{ paddingTop: 5, fontSize: '0.9em', opacity: 0.8 }}>{tool.content}</div> */}
						</ToolMessageCard>
					)
				default:
					return null
			}
		}

		// Reset output expansion state when command stops (completes or is cancelled)
		useEffect(() => {
			// If command was executing and now isn't, clean up
			if (isCommandMessage && prevCommandExecutingRef.current && !isCommandExecuting) {
				setIsOutputFullyExpanded(false)
			}

			// Update ref for next render
			prevCommandExecutingRef.current = isCommandExecuting
		}, [isCommandMessage, isCommandExecuting])

		// Auto-expand when command starts executing (only if running > 500ms)
		useEffect(() => {
			if (isCommandMessage && isCommandExecuting && !isExpanded) {
				// Wait 500ms before auto-expanding to avoid animating fast commands
				const timer = setTimeout(() => {
					// Expand after 500ms
					onToggleExpand(message.ts)
				}, 500)

				return () => clearTimeout(timer)
			}
		}, [isCommandMessage, isCommandExecuting, isExpanded, onToggleExpand, message.ts])

		if (message.ask === "command" || message.say === "command") {
			const splitMessage = (text: string) => {
				const outputIndex = text.indexOf(COMMAND_OUTPUT_STRING)
				if (outputIndex === -1) {
					return { command: text, output: "" }
				}
				return {
					command: text.slice(0, outputIndex).trim(),
					output: text
						.slice(outputIndex + COMMAND_OUTPUT_STRING.length)
						.trim()
						.split("")
						.map((char) => {
							switch (char) {
								case "\t":
									return "→   "
								case "\b":
									return "⌫"
								case "\f":
									return "⏏"
								case "\v":
									return "⇳"
								default:
									return char
							}
						})
						.join(""),
				}
			}

			const { command: rawCommand, output } = splitMessage(message.text || "")

			const requestsApproval = rawCommand.endsWith(COMMAND_REQ_APP_STRING)
			const command = requestsApproval ? rawCommand.slice(0, -COMMAND_REQ_APP_STRING.length) : rawCommand
			// The stop button is offered in BOTH terminal modes: backgroundExec kills the
			// real process, vscodeTerminal sends Ctrl+C + detaches. Previously gating this to
			// backgroundExec left default-mode users with no way to cancel a hung command.
			const showCancelButton = (isCommandExecuting || isCommandPending) && typeof onCancelCommand === "function"

			const commandHeader = (
				<div className="chat-row-header">
					{icon}
					{title}
				</div>
			)

			return (
				<>
					{commandHeader}
					<div
						style={{
							borderRadius: 6,
							border: "1px solid var(--vscode-editorGroup-border)",
							overflow: "hidden",
							backgroundColor: CHAT_ROW_EXPANDED_BG_COLOR,
							transition: "all 0.3s ease-in-out",
						}}>
						{command && (
							<div
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									padding: "8px 10px",
									backgroundColor: CHAT_ROW_EXPANDED_BG_COLOR,
									borderBottom: "1px solid var(--vscode-editorGroup-border)",
									borderTopLeftRadius: "6px",
									borderTopRightRadius: "6px",
									borderBottomLeftRadius: 0,
									borderBottomRightRadius: 0,
								}}>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: "8px",
										flex: 1,
										minWidth: 0,
									}}>
									{(() => {
										// Single source of truth for the command status pill: an
										// approved-but-output-less command shows an active "Starting…"
										// (it IS running), while an approval request shows a static
										// "Awaiting approval" so a stalled command is never mistaken
										// for one that is merely waiting on the user.
										const runningColor = "var(--vscode-charts-blue)"
										const warningColor = "var(--vscode-editorWarning-foreground)"
										const idleColor = "var(--vscode-descriptionForeground)"
										let statusColor = idleColor
										let statusLabel = "Not Executed"
										let statusPulse = false
										if (isCommandExecuting) {
											statusColor = runningColor
											statusLabel = "Running"
											statusPulse = true
										} else if (isCommandStarting) {
											statusColor = runningColor
											statusLabel = "Starting…"
											statusPulse = true
										} else if (isCommandAwaitingApproval) {
											statusColor = warningColor
											statusLabel = "Awaiting approval"
										} else if (isCommandPending) {
											statusColor = warningColor
											statusLabel = "Pending"
										} else if (isCommandCompleted) {
											statusColor = idleColor
											statusLabel = "Completed"
										}
										return (
											<>
												<div
													style={{
														width: "8px",
														height: "8px",
														borderRadius: "50%",
														backgroundColor: statusColor,
														animation: statusPulse ? "pulse 2s ease-in-out infinite" : "none",
														flexShrink: 0,
													}}
												/>
												<span
													style={{
														color: statusColor,
														fontWeight: 500,
														fontSize: "13px",
														flexShrink: 0,
													}}>
													{statusLabel}
												</span>
											</>
										)
									})()}
								</div>
								<div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
									{showCancelButton && (
										<button
											onClick={(e) => {
												e.stopPropagation()
												// Works in both modes now: backgroundExec kills the process,
												// vscodeTerminal sends Ctrl+C + detaches the listener.
												onCancelCommand?.()
											}}
											onMouseEnter={(e) => {
												e.currentTarget.style.background = "var(--vscode-button-secondaryHoverBackground)"
											}}
											onMouseLeave={(e) => {
												e.currentTarget.style.background = "var(--vscode-button-secondaryBackground)"
											}}
											style={{
												background: "var(--vscode-button-secondaryBackground)",
												color: "var(--vscode-button-secondaryForeground)",
												border: "none",
												borderRadius: "2px",
												padding: "4px 10px",
												fontSize: "12px",
												cursor: "pointer",
												fontFamily: "inherit",
											}}>
											{vscodeTerminalExecutionMode === "backgroundExec" ? "cancel" : "stop"}
										</button>
									)}
								</div>
							</div>
						)}
						{(() => {
							const commandLines = command.split("\n")
							const isLongCommand = commandLines.length > 1 || command.length > 120
							const showFull = isCommandExpanded || !isLongCommand
							return (
								<div style={{ opacity: 0.6, backgroundColor: CHAT_ROW_EXPANDED_BG_COLOR }}>
									{isLongCommand && (
										<div
											onClick={() => setIsCommandExpanded((v) => !v)}
											style={{
												display: "flex",
												alignItems: "center",
												gap: "6px",
												padding: "6px 10px",
												cursor: "pointer",
												fontFamily: "var(--vscode-editor-font-family)",
												fontSize: "12px",
												whiteSpace: "nowrap",
												overflow: "hidden",
											}}>
											<span className={`codicon codicon-chevron-${showFull ? "down" : "right"}`} />
											<span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
												{commandLines[0]}
											</span>
											{!showFull && (
												<span style={{ flexShrink: 0, opacity: 0.7 }}>
													{`  (+${commandLines.length - 1} more line${
														commandLines.length - 1 === 1 ? "" : "s"
													})`}
												</span>
											)}
										</div>
									)}
									{showFull && (
										<div style={{ backgroundColor: CHAT_ROW_EXPANDED_BG_COLOR }}>
											<CodeBlock forceWrap={true} source={`${"```"}shell\n${command}\n${"```"}`} />
										</div>
									)}
								</div>
							)
						})()}
						{output.length > 0 && (
							<CommandOutput
								isContainerExpanded={true}
								isOutputFullyExpanded={isOutputFullyExpanded}
								onToggle={() => setIsOutputFullyExpanded(!isOutputFullyExpanded)}
								output={output}
							/>
						)}
					</div>
					{requestsApproval && (
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 10,
								padding: 8,
								fontSize: "12px",
								color: "var(--vscode-editorWarning-foreground)",
							}}>
							<i className="codicon codicon-warning"></i>
							<span>The model has determined this command requires explicit approval.</span>
						</div>
					)}
				</>
			)
		}

		if (message.ask === "use_mcp_server" || message.say === "use_mcp_server") {
			const useMcpServer = JSON.parse(message.text || "{}") as AiHydroAskUseMcpServer
			const server = mcpServers.find((server) => server.name === useMcpServer.serverName)
			// Server-identity switch (never per tool): first-party science calls render as a semantic card.
			const scienceCall = useMcpServer.type === "use_mcp_tool" && isScienceServer(useMcpServer.serverName)
			const sciencePair = scienceCall ? getPairing(aihydroMessages ?? []).byCallTs.get(message.ts) : undefined
			const scienceTool = scienceCall ? server?.tools?.find((tool) => tool.name === useMcpServer.toolName) : undefined
			return (
				<>
					<div className="chat-row-header">
						{icon}
						{title}
						{isMcpServerResponding && (
							<span
								style={{
									marginLeft: "auto",
									display: "inline-flex",
									alignItems: "center",
									gap: "5px",
									fontSize: "11px",
									color: "var(--ai-hydro-teal, var(--vscode-charts-blue))",
									opacity: 0.9,
									animation: "pulse 1.5s ease-in-out infinite",
								}}>
								<span
									style={{
										width: "6px",
										height: "6px",
										borderRadius: "50%",
										backgroundColor: "currentColor",
										display: "inline-block",
										animation: "pulse 1.5s ease-in-out infinite",
									}}
								/>
								Running…
							</span>
						)}
					</div>

					{isPendingAsk && useMcpServer.autoApprovePaused && (
						<div
							className="mt-1 text-[12px]"
							data-testid="mcp-always-paused"
							style={{ color: "var(--vscode-editorWarning-foreground)" }}>
							{useMcpServer.autoApprovePaused}
						</div>
					)}

					{scienceCall ? (
						<ScienceToolCard
							annotations={scienceTool?.annotations}
							approved={askOutcome === "approved"}
							argsJson={useMcpServer.arguments}
							awaitingPermission={isPendingAsk}
							denied={askOutcome === "denied"}
							failed={askOutcome === "failed"}
							resultText={sciencePair?.status === "paired" ? sciencePair.resultText : undefined}
							running={isMcpServerResponding || askOutcome === "running"}
							serverName={useMcpServer.serverName}
							toolMeta={{ description: scienceTool?.description, inputSchema: scienceTool?.inputSchema }}
							toolName={useMcpServer.toolName || ""}
							unpaired={sciencePair?.status === "unpaired"}
						/>
					) : (
						<div
							style={{
								background: "var(--vscode-textCodeBlock-background)",
								borderRadius: "3px",
								padding: "8px 10px",
								marginTop: "8px",
							}}>
							{useMcpServer.type === "access_mcp_resource" && (
								<McpResourceRow
									item={{
										...(findMatchingResourceOrTemplate(
											useMcpServer.uri || "",
											server?.resources,
											server?.resourceTemplates,
										) || {
											name: "",
											mimeType: "",
											description: "",
										}),
										uri: useMcpServer.uri || "",
									}}
								/>
							)}

							{useMcpServer.type === "use_mcp_tool" && (
								<>
									<div onClick={(e) => e.stopPropagation()}>
										<McpToolRow
											compact={true}
											serverConnected={server?.status === "connected"}
											serverName={useMcpServer.serverName}
											serverTools={server?.tools}
											serverTrusted={server?.trust?.trusted === true}
											tool={{
												name: useMcpServer.toolName || "",
												description:
													server?.tools?.find((tool) => tool.name === useMcpServer.toolName)
														?.description || "",
												autoApprove:
													server?.tools?.find((tool) => tool.name === useMcpServer.toolName)
														?.autoApprove || false,
											}}
										/>
									</div>
									{useMcpServer.arguments && useMcpServer.arguments !== "{}" && (
										<div style={{ marginTop: "8px" }}>
											<CodeAccordian
												code={useMcpServer.arguments}
												isExpanded={isExpanded}
												language="json"
												onToggleExpand={handleToggle}
												path="arguments"
											/>
										</div>
									)}
								</>
							)}
						</div>
					)}
				</>
			)
		}

		switch (message.type) {
			case "say":
				switch (message.say) {
					case "api_req_started":
						return (
							<>
								<div
									onClick={handleToggle}
									style={{
										marginBottom:
											(cost == null && apiRequestFailedMessage) || apiReqStreamingFailedMessage ? 10 : 0,
										justifyContent: "space-between",
										cursor: "pointer",
										userSelect: "none",
										WebkitUserSelect: "none",
										MozUserSelect: "none",
										msUserSelect: "none",
									}}>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: "10px",
										}}>
										{icon}
										{title}
										{/* Need to render this every time since it affects height of row by 2px */}
										<VSCodeBadge
											style={{
												opacity: costStatus === "unavailable" || (cost != null && cost > 0) ? 1 : 0,
											}}>
											{costStatus === "unavailable"
												? "cost unavailable (pricing not verified)"
												: costStatus === "lower-bound"
													? `\u2265$${Number(cost || 0).toFixed(4)} (cache tokens unpriced)`
													: `$${Number(cost || 0)?.toFixed(4)}`}
										</VSCodeBadge>
									</div>
									<span className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`}></span>
								</div>
								{((cost == null && apiRequestFailedMessage) || apiReqStreamingFailedMessage) && (
									<ErrorRow
										apiReqStreamingFailedMessage={apiReqStreamingFailedMessage}
										apiRequestFailedMessage={apiRequestFailedMessage}
										errorType="error"
										message={message}
									/>
								)}

								{isExpanded && (
									<div style={{ marginTop: "10px" }}>
										<CodeAccordian
											code={JSON.parse(message.text || "{}").request}
											isExpanded={true}
											language="markdown"
											onToggleExpand={handleToggle}
										/>
									</div>
								)}
							</>
						)
					case "api_req_finished":
						return null // we should never see this message type
					case "mcp_server_response":
						return <McpResponseDisplay responseText={message.text || ""} />
					case "answer_audit":
						return <AnswerAuditSummary partial={message.partial} text={message.text} />
					case "info":
						return <MutedNotice severity={message.infoNotice?.severity} text={message.text} />
					case "mcp_notification":
						return (
							<div className="chat-row-mcp-notification" data-level={message.mcpLevel}>
								<i
									className="codicon codicon-bell chat-row-mcp-notification-icon"
									style={
										isElevatedMcpLevel(message.mcpLevel)
											? { color: "var(--vscode-editorWarning-foreground)" }
											: undefined
									}
								/>
								<div className="flex-1 break-words">
									<span style={{ fontWeight: 500 }}>MCP Notification: </span>
									<span className="ph-no-capture">{message.text}</span>
								</div>
							</div>
						)
					case "text":
						return (
							<WithCopyButton
								onMouseUp={handleMouseUp}
								position="bottom-right"
								ref={contentRef}
								textToCopy={message.text}>
								<Markdown markdown={message.text} />
								{quoteButtonState.visible && (
									<QuoteButton
										left={quoteButtonState.left}
										onClick={() => {
											handleQuoteClick()
										}}
										top={quoteButtonState.top}
									/>
								)}
							</WithCopyButton>
						)
					case "reasoning":
						return (
							<>
								{message.text && (
									<div
										className={`reasoning-card${message.partial === true ? " animate-thinking-shimmer" : ""}`}
										onClick={handleToggle}
										style={{
											cursor: "pointer",
											color: "var(--vscode-descriptionForeground)",
											overflow: "hidden",
										}}>
										{isExpanded ? (
											<div style={{ marginTop: -3 }}>
												<div
													style={{
														display: "flex",
														alignItems: "center",
														gap: "6px",
														marginBottom: "6px",
													}}>
													<span
														className="codicon codicon-lightbulb"
														style={{
															color: "var(--ai-hydro-teal)",
															fontSize: "14px",
															marginBottom: "-1.5px",
														}}
													/>
													<span style={{ fontWeight: "bold", display: "block" }}>
														Thinking
														<span
															className="codicon codicon-chevron-down"
															style={{
																display: "inline-block",
																transform: "translateY(3px)",
																marginLeft: "1.5px",
															}}
														/>
													</span>
												</div>
												<span className="ph-no-capture" style={{ fontStyle: "italic" }}>
													{message.text}
												</span>
											</div>
										) : (
											<div style={{ display: "flex", alignItems: "center" }}>
												<span
													className="codicon codicon-lightbulb"
													style={{
														color: "var(--ai-hydro-teal)",
														fontSize: "14px",
														marginRight: "6px",
														marginBottom: "-1.5px",
														flexShrink: 0,
													}}
												/>
												<span style={{ fontWeight: "bold", marginRight: "4px", flexShrink: 0 }}>
													Thinking:
												</span>
												<span
													className="ph-no-capture"
													style={{
														whiteSpace: "nowrap",
														overflow: "hidden",
														textOverflow: "ellipsis",
														direction: "rtl",
														textAlign: "left",
														flex: 1,
													}}>
													{message.text + "\u200E"}
												</span>
												<span
													className="codicon codicon-chevron-right"
													style={{
														marginLeft: "4px",
														flexShrink: 0,
													}}
												/>
											</div>
										)}
									</div>
								)}
							</>
						)
					case "user_feedback":
						return (
							<UserMessage
								files={message.files}
								images={message.images}
								messageTs={message.ts}
								sendMessageFromChatRow={sendMessageFromChatRow}
								text={message.text}
							/>
						)
					case "user_feedback_diff":
						const tool = JSON.parse(message.text || "{}") as AiHydroSayTool
						return (
							<div
								style={{
									marginTop: -10,
									width: "100%",
								}}>
								<CodeAccordian
									diff={tool.diff!}
									isExpanded={isExpanded}
									isFeedback={true}
									onToggleExpand={handleToggle}
								/>
							</div>
						)
					case "error":
						return <ErrorRow errorType="error" message={message} />
					case "diff_error":
						return <ErrorRow errorType="diff_error" message={message} />
					case "aihydroignore_error":
						return <ErrorRow errorType="aihydroignore_error" message={message} />
					case "checkpoint_created":
						return <CheckmarkControl isCheckpointCheckedOut={message.isCheckpointCheckedOut} messageTs={message.ts} />
					case "load_mcp_documentation":
						return (
							<div
								style={{
									display: "flex",
									alignItems: "center",
									color: "var(--vscode-foreground)",
									opacity: 0.7,
									fontSize: 12,
									padding: "4px 0",
								}}>
								<i className="codicon codicon-book" style={{ marginRight: 6 }} />
								Loading MCP documentation
							</div>
						)
					case "completion_result": {
						const hasChanges = message.text?.endsWith(COMPLETION_RESULT_CHANGES_FLAG) ?? false
						const text =
							(hasChanges ? message.text?.slice(0, -COMPLETION_RESULT_CHANGES_FLAG.length) : message.text) ?? ""
						return (
							<AnswerBlock
								audit={answer?.audit}
								hasChanges={message.partial !== true && hasChanges}
								onSeeChanges={viewCompletionChanges}
								onSendFeedback={isLast ? answer?.onSendFeedback : undefined}
								partial={message.partial}
								seeChangesDisabled={seeNewChangesDisabled}
								text={text}
								turn={answer?.turn}>
								{answerBody(text)}
							</AnswerBlock>
						)
					}
					case "shell_integration_warning":
						return (
							<div className="chat-row-shell-warning">
								<div className="chat-row-shell-warning-header">
									<i className="codicon codicon-warning chat-row-shell-warning-icon"></i>
									<span className="chat-row-shell-warning-title">Shell Integration Unavailable</span>
								</div>
								<div className="chat-row-retry-body">
									AI-Hydro may have trouble viewing the command's output. Please update VSCode (
									<code>CMD/CTRL + Shift + P</code> → "Update") and make sure you're using a supported shell:
									zsh, bash, fish, or PowerShell (<code>CMD/CTRL + Shift + P</code> → "Terminal: Select Default
									Profile").{" "}
									<a
										href="https://github.com/AI-Hydro/AI-Hydro/issues"
										style={{
											color: "inherit",
											textDecoration: "underline",
										}}>
										Still having trouble?
									</a>
								</div>
							</div>
						)
					case "error_retry":
						try {
							const retryInfo = JSON.parse(message.text || "{}")
							const { attempt, maxAttempts, delaySeconds, failed } = retryInfo
							const isFailed = failed === true

							return (
								<div className="chat-row-retry-box">
									<div className="chat-row-retry-header">
										<i
											className={
												isFailed
													? "codicon codicon-warning chat-row-retry-icon"
													: "codicon codicon-sync chat-row-retry-icon"
											}></i>
										<span className="chat-row-retry-title">
											{isFailed ? "Auto-Retry Failed" : "Auto-Retry in Progress"}
										</span>
									</div>
									<div className="chat-row-retry-body">
										{isFailed ? (
											<>
												Auto-retry failed after <strong>{maxAttempts}</strong> attempts. Manual
												intervention required.
											</>
										) : (
											<>
												Attempt <strong>{attempt}</strong> of <strong>{maxAttempts}</strong> - Retrying in{" "}
												{delaySeconds} seconds...
											</>
										)}
									</div>
								</div>
							)
						} catch (_e) {
							// Fallback if JSON parsing fails
							return (
								<div style={{ color: "var(--vscode-foreground)" }}>
									<Markdown markdown={message.text} />
								</div>
							)
						}
					case "shell_integration_warning_with_suggestion":
						const isBackgroundModeEnabled = vscodeTerminalExecutionMode === "backgroundExec"
						return (
							<div className="chat-row-shell-suggestion">
								<div className="chat-row-shell-suggestion-header">
									<i className="codicon codicon-lightbulb chat-row-shell-suggestion-icon"></i>
									<span className="chat-row-shell-suggestion-title">Shell integration issues</span>
								</div>
								<div style={{ opacity: 0.9, marginBottom: 8 }}>
									Since you're experiencing repeated shell integration issues, we recommend switching to
									Background Terminal mode for better reliability.
								</div>
								<button
									className="chat-row-shell-suggestion-btn"
									disabled={isBackgroundModeEnabled}
									onClick={async () => {
										try {
											// Enable background terminal execution mode
											await UiServiceClient.setTerminalExecutionMode(BooleanRequest.create({ value: true }))
										} catch (error) {
											console.error("Failed to enable background terminal:", error)
										}
									}}>
									<i className="codicon codicon-settings-gear"></i>
									{isBackgroundModeEnabled
										? "Background Terminal Enabled"
										: "Enable Background Terminal (Recommended)"}
								</button>
							</div>
						)
					case "task_progress":
						return null // task_progress messages should be displayed in TaskHeader only, not in chat
					case "html_preview":
						// Parse metadata from message text: { title, filePath, mode, size }
						const previewMeta = (() => {
							try {
								return JSON.parse(message.text || "{}")
							} catch {
								return {}
							}
						})()

						// external_browser mode: show informational message
						if (previewMeta.mode === "external_browser") {
							return (
								<>
									<div className="chat-row-header">
										<span
											className="codicon codicon-link-external"
											style={{ color: normalColor, marginBottom: "-1.5px" }}
										/>
										<span className="font-bold">HTML opened in browser</span>
									</div>
									<div style={{ paddingTop: 8 }}>
										<p className="text-sm text-[var(--vscode-descriptionForeground)]">
											{previewMeta.title || "Document"} opened in external browser
										</p>
									</div>
								</>
							)
						}

						// Find matching item from HtmlPreviewContext (items are streamed via gRPC)
						const previewItem = previewMeta.title
							? htmlPreviewItems.find(
									(item) =>
										item.title === previewMeta.title &&
										item.htmlContent?.length &&
										(!previewMeta.filePath || item.filePath === previewMeta.filePath),
								)
							: undefined

						// Item exists in context — render the full interactive preview inline
						if (previewItem) {
							return (
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										height: 420,
										border: "1px solid var(--vscode-panel-border)",
										borderRadius: 4,
										overflow: "hidden",
										marginTop: 4,
									}}>
									<HtmlPreviewView item={previewItem} />
								</div>
							)
						}

						// Fallback: item not yet available in context — show metadata with info
						return (
							<>
								<div className="chat-row-header">
									<span
										className="codicon codicon-browser"
										style={{ color: normalColor, marginBottom: "-1.5px" }}
									/>
									<span className="font-bold">Opened in AI-Hydro Studio</span>
								</div>
								<div style={{ paddingTop: 8 }}>
									<Markdown
										markdown={`In the Studio panel: **${previewMeta.title || "AI-Hydro Studio"}**${
											previewMeta.filePath ? `\n\nFile: \`${previewMeta.filePath}\`` : ""
										}`}
									/>
								</div>
							</>
						)
					default:
						return (
							<>
								{title && (
									<div className="chat-row-header">
										{icon}
										{title}
									</div>
								)}
								<div style={{ paddingTop: 10 }}>
									<Markdown markdown={message.text} />
								</div>
							</>
						)
				}
			case "ask":
				switch (message.ask) {
					case "mistake_limit_reached":
						return <ErrorRow errorType="mistake_limit_reached" message={message} />
					case "auto_approval_max_req_reached":
						return <ErrorRow errorType="auto_approval_max_req_reached" message={message} />
					case "completion_result":
						if (message.text) {
							const hasChanges = message.text.endsWith(COMPLETION_RESULT_CHANGES_FLAG) ?? false
							const text = hasChanges ? message.text.slice(0, -COMPLETION_RESULT_CHANGES_FLAG.length) : message.text
							return (
								<AnswerBlock
									audit={answer?.audit}
									feedback={
										<TaskFeedbackButtons
											isFromHistory={
												!isLast ||
												lastModifiedMessage?.ask === "resume_completed_task" ||
												lastModifiedMessage?.ask === "resume_task"
											}
											messageTs={message.ts}
										/>
									}
									hasChanges={message.partial !== true && hasChanges}
									onSeeChanges={viewCompletionChanges}
									onSendFeedback={isLast ? answer?.onSendFeedback : undefined}
									partial={message.partial}
									seeChangesDisabled={seeNewChangesDisabled}
									text={text}
									turn={answer?.turn}>
									{answerBody(text)}
								</AnswerBlock>
							)
						} else {
							return null // Don't render anything when we get a completion_result ask without text
						}
					case "followup":
						let question: string | undefined
						let options: string[] | undefined
						let selected: string | undefined
						try {
							const parsedMessage = JSON.parse(message.text || "{}") as AiHydroAskQuestion
							question = parsedMessage.question
							options = parsedMessage.options
							selected = parsedMessage.selected
						} catch (_e) {
							// legacy messages would pass question directly
							question = message.text
						}

						return (
							<>
								{title && (
									<div className="chat-row-header">
										{icon}
										{title}
									</div>
								)}
								<WithCopyButton
									className="pt-2.5"
									onMouseUp={handleMouseUp}
									position="bottom-right"
									ref={contentRef}
									textToCopy={question}>
									<Markdown markdown={question} />
									<OptionsButtons
										askTs={message.ts}
										inputValue={inputValue}
										isActive={
											(isLast && lastModifiedMessage?.ask === "followup") ||
											(!selected && options && options.length > 0)
										}
										options={options}
										selected={selected}
									/>
									{quoteButtonState.visible && (
										<QuoteButton
											left={quoteButtonState.left}
											onClick={() => {
												handleQuoteClick()
											}}
											top={quoteButtonState.top}
										/>
									)}
								</WithCopyButton>
							</>
						)
					case "install_dependencies":
						return (
							<>
								<div className="chat-row-header">
									<span className="mr-2 text-base">📦</span>
									<span className="font-bold" style={{ color: normalColor }}>
										AI-Hydro RAG Brain Setup:
									</span>
								</div>
								<WithCopyButton
									className="pt-2.5"
									onMouseUp={handleMouseUp}
									position="bottom-right"
									ref={contentRef}
									textToCopy={message.text}>
									<Markdown markdown={message.text} />
									{quoteButtonState.visible && (
										<QuoteButton
											left={quoteButtonState.left}
											onClick={() => {
												handleQuoteClick()
											}}
											top={quoteButtonState.top}
										/>
									)}
								</WithCopyButton>
							</>
						)
					case "workspace_env_setup":
						try {
							const workspaceInfo = JSON.parse(message.text || "{}")
							return (
								<>
									<div className="chat-row-header">
										<span className="mr-2 text-base">🐍</span>
										<span className="font-bold" style={{ color: normalColor }}>
											AI-Hydro Workspace Environment Setup:
										</span>
									</div>
									<div className="pt-2.5 pb-2.5">
										<div
											style={{
												backgroundColor: "var(--vscode-textBlockQuote-background)",
												borderRadius: "4px",
												padding: "12px",
												marginBottom: "10px",
											}}>
											<div style={{ marginBottom: "8px" }}>
												<strong>📁 Workspace:</strong>
												<div
													className="ph-no-capture"
													style={{
														fontFamily: "var(--vscode-editor-font-family)",
														fontSize: "12px",
														opacity: 0.9,
														marginTop: "4px",
													}}>
													{workspaceInfo.workspaceRoot || "No workspace open"}
												</div>
											</div>
											<div style={{ marginBottom: "8px" }}>
												<strong>🔧 Environment Path:</strong>
												<div
													style={{
														fontFamily: "var(--vscode-editor-font-family)",
														fontSize: "12px",
														opacity: 0.9,
														marginTop: "4px",
													}}>
													{workspaceInfo.envPath || ".ai-hydro-env"}
												</div>
											</div>
											<div style={{ marginBottom: "8px" }}>
												<strong>💾 Disk Space:</strong>
												<span
													style={{
														marginLeft: "8px",
														fontSize: "12px",
														opacity: 0.9,
													}}>
													{workspaceInfo.diskSpace || "~800MB"}
												</span>
											</div>
											<div>
												<strong>⏱️ Estimated Time:</strong>
												<span
													style={{
														marginLeft: "8px",
														fontSize: "12px",
														opacity: 0.9,
													}}>
													{workspaceInfo.estimatedTime || "2-5 minutes"}
												</span>
											</div>
										</div>
										<div
											style={{
												fontSize: "13px",
												opacity: 0.8,
												marginTop: "12px",
											}}>
											This will create an isolated Python environment in your workspace for AI-Hydro's
											hydrological knowledge base.
										</div>
									</div>
								</>
							)
						} catch (_e) {
							// Fallback if JSON parsing fails
							return (
								<>
									<div className="chat-row-header">
										<span className="mr-2 text-base">🐍</span>
										<span className="font-bold" style={{ color: normalColor }}>
											AI-Hydro Workspace Environment Setup:
										</span>
									</div>
									<WithCopyButton
										onMouseUp={handleMouseUp}
										position="bottom-right"
										ref={contentRef}
										style={{ paddingTop: 10 }}
										textToCopy={message.text}>
										<Markdown markdown={message.text} />
										{quoteButtonState.visible && (
											<QuoteButton
												left={quoteButtonState.left}
												onClick={() => {
													handleQuoteClick()
												}}
												top={quoteButtonState.top}
											/>
										)}
									</WithCopyButton>
								</>
							)
						}
					case "browser_action_launch":
						// A pending launch used to fall through to `return null`: an empty card with nothing to approve.
						return (
							<>
								<div className="chat-row-header">
									<span
										className="codicon codicon-globe"
										style={{
											color: normalColor,
											marginBottom: "-1.5px",
										}}></span>
									<span className="font-bold" style={{ color: normalColor }}>
										{isPendingAsk
											? "AI-Hydro wants to launch a browser:"
											: "AI-Hydro asked to launch a browser:"}
									</span>
								</div>
								{message.text && (
									<div className="browser-code-block-container" style={{ marginTop: 8 }}>
										<CodeBlock forceWrap={true} source={`${"```"}shell\n${message.text}\n${"```"}`} />
									</div>
								)}
							</>
						)
					case "new_task":
						return (
							<>
								<div className="chat-row-header">
									<span
										className="codicon codicon-new-file"
										style={{
											color: normalColor,
											marginBottom: "-1.5px",
										}}></span>
									<span className="font-bold" style={{ color: normalColor }}>
										AI-Hydro wants to start a new task:
									</span>
								</div>
								<NewTaskPreview context={message.text || ""} />
							</>
						)
					case "condense":
						return (
							<>
								<div className="chat-row-header">
									<span
										className="codicon codicon-new-file"
										style={{
											color: normalColor,
											marginBottom: "-1.5px",
										}}></span>
									<span className="font-bold" style={{ color: normalColor }}>
										AI-Hydro wants to condense your conversation:
									</span>
								</div>
								<NewTaskPreview context={message.text || ""} />
							</>
						)
					case "report_bug":
						return (
							<>
								<div className="chat-row-header">
									<span
										className="codicon codicon-new-file"
										style={{
											color: normalColor,
											marginBottom: "-1.5px",
										}}></span>
									<span className="font-bold" style={{ color: normalColor }}>
										AI-Hydro wants to create a Github issue:
									</span>
								</div>
								<ReportBugPreview data={message.text || ""} />
							</>
						)
					case "plan_mode_respond": {
						let response: string | undefined
						let options: string[] | undefined
						let selected: string | undefined
						try {
							const parsedMessage = JSON.parse(message.text || "{}") as AiHydroPlanModeResponse
							response = parsedMessage.response
							options = parsedMessage.options
							selected = parsedMessage.selected
						} catch (_e) {
							// legacy messages would pass response directly
							response = message.text
						}
						return (
							<WithCopyButton
								onMouseUp={handleMouseUp}
								position="bottom-right"
								ref={contentRef}
								textToCopy={response}>
								<Markdown markdown={response} />
								<OptionsButtons
									askTs={message.ts}
									inputValue={inputValue}
									isActive={
										(isLast && lastModifiedMessage?.ask === "plan_mode_respond") ||
										(!selected && options && options.length > 0)
									}
									options={options}
									selected={selected}
								/>
								{quoteButtonState.visible && (
									<QuoteButton
										left={quoteButtonState.left}
										onClick={() => {
											handleQuoteClick()
										}}
										top={quoteButtonState.top}
									/>
								)}
							</WithCopyButton>
						)
					}
					default:
						return null
				}
		}
	},
)
