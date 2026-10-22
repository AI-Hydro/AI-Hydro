import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { AskResponseRequest, NewTaskRequest } from "@shared/proto/cline/task"
import { useCallback } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { SlashServiceClient, TaskServiceClient } from "@/services/grpc-client"
import type { ButtonActionType } from "../shared/buttonConfig"
import type { ChatState, MessageHandlers } from "../types/chatTypes"

export const STALE_ASK_NOTICE = "That request changed — review again"

/**
 * Custom hook for managing message handlers
 * Handles sending messages, button clicks, and task management
 */
export function useMessageHandlers(messages: AiHydroMessage[], chatState: ChatState): MessageHandlers {
	const { backgroundCommandRunning } = useExtensionState()
	const {
		setInputValue,
		activeQuote,
		setActiveQuote,
		setSelectedImages,
		setSelectedFiles,
		setSendingDisabled,
		setEnableButtons,
		aihydroAsk,
		lastMessage,
		setAskNotice,
	} = chatState

	// Every ask response names the ask it answers (W2-E1, M-1): the ts of the pending ask message, or `askTsOverride`
	// (an inline card passes its own). The host drops a response whose ask has since changed and says so; the user
	// then reviews the new request instead of silently answering it. Resolves true when the response was dropped.
	const answerAsk = useCallback(
		async (fields: Partial<AskResponseRequest>, askTsOverride?: number): Promise<boolean> => {
			const askTs = askTsOverride ?? (lastMessage?.type === "ask" ? lastMessage.ts : 0)
			const result = await TaskServiceClient.askResponse(AskResponseRequest.create({ ...fields, askTs }))
			if (result?.stale) {
				setAskNotice?.(STALE_ASK_NOTICE)
				return true
			}
			return false
		},
		[lastMessage, setAskNotice],
	)

	// Handle sending a message
	const handleSendMessage = useCallback(
		async (text: string, images: string[], files: string[]) => {
			let messageToSend = text.trim()
			const hasContent = messageToSend || images.length > 0 || files.length > 0

			// Prepend the active quote if it exists
			if (activeQuote && hasContent) {
				const prefix = "[context] \n> "
				const formattedQuote = activeQuote
				const suffix = "\n[/context] \n\n"
				messageToSend = `${prefix} ${formattedQuote} ${suffix} ${messageToSend}`
			}

			if (hasContent) {
				console.log("[ChatView] handleSendMessage - Sending message:", messageToSend)
				if (messages.length === 0) {
					await TaskServiceClient.newTask(
						NewTaskRequest.create({
							text: messageToSend,
							images,
							files,
						}),
					)
				} else if (aihydroAsk) {
					switch (aihydroAsk) {
						case "followup":
						case "plan_mode_respond":
						case "tool":
						case "browser_action_launch":
						case "command":
						case "command_output":
						case "use_mcp_server":
						case "completion_result":
						case "resume_task":
						case "resume_completed_task":
						case "mistake_limit_reached":
						case "auto_approval_max_req_reached":
						case "api_req_failed":
						case "new_task":
						case "condense":
						case "report_bug":
							if (
								await answerAsk({
									responseType: "messageResponse",
									text: messageToSend,
									images,
									files,
								})
							) {
								// Dropped as stale: keep the draft, quote and attachments so nothing is lost.
								return
							}
							break
					}
				}
				setInputValue("")
				setActiveQuote(null)
				setSendingDisabled(true)
				setSelectedImages([])
				setSelectedFiles([])
				setEnableButtons(false)

				// Reset auto-scroll
				if ("disableAutoScrollRef" in chatState) {
					;(chatState as any).disableAutoScrollRef.current = false
				}
			}
		},
		[
			answerAsk,
			messages.length,
			aihydroAsk,
			activeQuote,
			setInputValue,
			setActiveQuote,
			setSendingDisabled,
			setSelectedImages,
			setSelectedFiles,
			setEnableButtons,
			chatState,
		],
	)

	// Reply to the pending completion with fixed text, leaving the user's draft, quote and attachments alone.
	const sendAnswerFeedback = useCallback(
		async (text: string): Promise<boolean> => {
			if (aihydroAsk !== "completion_result" || !text.trim()) {
				return false
			}
			if (await answerAsk({ responseType: "messageResponse", text, images: [], files: [] })) {
				return false
			}
			// The agent is working again: same lock a normal reply applies.
			setSendingDisabled(true)
			setEnableButtons(false)
			return true
		},
		[answerAsk, aihydroAsk, setSendingDisabled, setEnableButtons],
	)

	// Start a new task
	const startNewTask = useCallback(async () => {
		setActiveQuote(null)
		await TaskServiceClient.clearTask(EmptyRequest.create({}))
	}, [setActiveQuote])

	// Clear input state helper
	const clearInputState = useCallback(() => {
		setInputValue("")
		setActiveQuote(null)
		setSelectedImages([])
		setSelectedFiles([])
	}, [setInputValue, setActiveQuote, setSelectedImages, setSelectedFiles])

	// Execute button action based on type
	const executeButtonAction = useCallback(
		async (actionType: ButtonActionType, text?: string, images?: string[], files?: string[], askTs?: number) => {
			const trimmedInput = text?.trim()
			const hasContent = trimmedInput || (images && images.length > 0) || (files && files.length > 0)

			switch (actionType) {
				case "retry":
					// For API retry (api_req_failed), always send simple approval without content
					if (await answerAsk({ responseType: "yesButtonClicked" }, askTs)) {
						break
					}
					clearInputState()
					break
				case "approve":
					if (
						await answerAsk(
							hasContent
								? { responseType: "yesButtonClicked", text: trimmedInput, images: images, files: files }
								: { responseType: "yesButtonClicked" },
							askTs,
						)
					) {
						break
					}
					clearInputState()
					break

				case "reject":
					if (
						await answerAsk(
							hasContent
								? { responseType: "noButtonClicked", text: trimmedInput, images: images, files: files }
								: { responseType: "noButtonClicked" },
							askTs,
						)
					) {
						break
					}
					clearInputState()
					break

				case "proceed":
					if (
						await answerAsk(
							hasContent
								? { responseType: "yesButtonClicked", text: trimmedInput, images: images, files: files }
								: { responseType: "yesButtonClicked" },
							askTs,
						)
					) {
						break
					}
					if (!hasContent) {
						clearInputState()
					}
					break

				case "new_task":
					if (aihydroAsk === "new_task") {
						await TaskServiceClient.newTask(
							NewTaskRequest.create({
								text: lastMessage?.text,
								images: [],
								files: [],
							}),
						)
					} else {
						await startNewTask()
					}
					break

				case "cancel":
					if (backgroundCommandRunning) {
						await TaskServiceClient.cancelBackgroundCommand(EmptyRequest.create({}))
					} else {
						await TaskServiceClient.cancelTask(EmptyRequest.create({}))
					}
					break

				case "utility":
					switch (aihydroAsk) {
						case "condense":
							await SlashServiceClient.condense(StringRequest.create({ value: lastMessage?.text })).catch((err) =>
								console.error(err),
							)
							break
						case "report_bug":
							await SlashServiceClient.reportBug(StringRequest.create({ value: lastMessage?.text })).catch((err) =>
								console.error(err),
							)
							break
					}
					break
			}

			if ("disableAutoScrollRef" in chatState) {
				;(chatState as any).disableAutoScrollRef.current = false
			}
		},
		[
			answerAsk,
			aihydroAsk,
			lastMessage,
			messages,
			clearInputState,
			handleSendMessage,
			startNewTask,
			chatState,
			backgroundCommandRunning,
		],
	)

	// Handle task close button click
	const handleTaskCloseButtonClick = useCallback(() => {
		startNewTask()
	}, [startNewTask])

	return {
		handleSendMessage,
		sendAnswerFeedback,
		executeButtonAction,
		handleTaskCloseButtonClick,
		startNewTask,
	}
}
