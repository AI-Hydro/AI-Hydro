import React, { useCallback, useEffect, useRef, useState } from "react"
import ChatTextArea from "@/components/chat/ChatTextArea"
import QuotedMessagePreview from "@/components/chat/QuotedMessagePreview"
import { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"

interface InputSectionProps {
	chatState: ChatState
	messageHandlers: MessageHandlers
	scrollBehavior: ScrollBehavior
	placeholderText: string
	shouldDisableFilesAndImages: boolean
	selectFilesAndImages: () => Promise<void>
	/** Escape in the prompt stops the task only while this is true. */
	isTaskRunning: boolean
}

/**
 * Input section including quoted message preview and chat text area
 */
export const InputSection: React.FC<InputSectionProps> = ({
	chatState,
	messageHandlers,
	scrollBehavior,
	placeholderText,
	shouldDisableFilesAndImages,
	selectFilesAndImages,
	isTaskRunning,
}) => {
	const {
		activeQuote,
		setActiveQuote,
		isTextAreaFocused,
		inputValue,
		setInputValue,
		sendingDisabled,
		selectedImages,
		setSelectedImages,
		selectedFiles,
		setSelectedFiles,
		textAreaRef,
		handleFocusChange,
	} = chatState

	const { isAtBottom, scrollToBottomAuto } = scrollBehavior

	// One guard for every stop path (button and Escape). Controller.cancelTask waits for the task to abort and then
	// re-initialises it, so concurrent cancels would re-init twice. Cleared when the task stops running, with a
	// safety reset in case the cancel never takes effect.
	const [stopping, setStopping] = useState(false)
	const stoppingRef = useRef(false)
	useEffect(() => {
		if (!isTaskRunning) {
			stoppingRef.current = false
			setStopping(false)
			return
		}
		if (!stopping) {
			return
		}
		const t = setTimeout(() => {
			stoppingRef.current = false
			setStopping(false)
		}, 8000)
		return () => clearTimeout(t)
	}, [isTaskRunning, stopping])
	const requestStop = useCallback(() => {
		if (!isTaskRunning || stoppingRef.current) {
			return
		}
		stoppingRef.current = true
		setStopping(true)
		messageHandlers.executeButtonAction("cancel")
	}, [isTaskRunning, messageHandlers])

	return (
		<>
			{activeQuote && (
				<div style={{ marginBottom: "-12px", marginTop: "10px" }}>
					<QuotedMessagePreview
						isFocused={isTextAreaFocused}
						onDismiss={() => setActiveQuote(null)}
						text={activeQuote}
					/>
				</div>
			)}

			<ChatTextArea
				activeQuote={activeQuote}
				inputValue={inputValue}
				isStopping={stopping}
				isTaskRunning={isTaskRunning}
				onEscape={requestStop}
				onFocusChange={handleFocusChange}
				onHeightChange={() => {
					if (isAtBottom) {
						scrollToBottomAuto()
					}
				}}
				onSelectFilesAndImages={selectFilesAndImages}
				onSend={() => messageHandlers.handleSendMessage(inputValue, selectedImages, selectedFiles)}
				onStop={requestStop}
				placeholderText={placeholderText}
				ref={textAreaRef}
				selectedFiles={selectedFiles}
				selectedImages={selectedImages}
				sendingDisabled={sendingDisabled}
				setInputValue={setInputValue}
				setSelectedFiles={setSelectedFiles}
				setSelectedImages={setSelectedImages}
				shouldDisableFilesAndImages={shouldDisableFilesAndImages}
			/>
		</>
	)
}
