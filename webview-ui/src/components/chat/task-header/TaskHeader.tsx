import { cn } from "@heroui/react"
import { AiHydroMessage } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/cline/common"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import React, { useCallback, useMemo } from "react"
import Thumbnails from "@/components/common/Thumbnails"
import { getModeSpecificFields, normalizeApiConfiguration } from "@/components/settings/utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { UiServiceClient } from "@/services/grpc-client"
import { getEnvironmentColor } from "@/utils/environmentColors"
import CopyTaskButton from "./buttons/CopyTaskButton"
import DeleteTaskButton from "./buttons/DeleteTaskButton"
import NewTaskButton from "./buttons/NewTaskButton"
import OpenDiskConversationHistoryButton from "./buttons/OpenDiskConversationHistoryButton"
import { CheckpointError } from "./CheckpointError"
import ContextWindow from "./ContextWindow"
import { FocusChain } from "./FocusChain"
import { highlightText } from "./Highlights"
import StudyChip, { StudyPickerPanel } from "./StudyChip"
import TaskTimeline from "./TaskTimeline"

const IS_DEV = process.env.IS_DEV === '"true"'
interface TaskHeaderProps {
	task: AiHydroMessage
	tokensIn: number
	tokensOut: number
	doesModelSupportPromptCache: boolean
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	lastApiReqTotalTokens?: number
	lastProgressMessageText?: string
	onClose: () => void
	onScrollToMessage?: (messageIndex: number) => void
	onSendMessage?: (command: string, files: string[], images: string[]) => void
}

/** 24 px minimum pointer target (WCAG 2.5.8); the old max-h-3 clipped these to 10 px. */
const BUTTON_CLASS = "min-h-[24px] h-[24px] border-0 font-bold bg-transparent hover:opacity-100 text-foreground"
const ICON_BUTTON_CLASS =
	"inline-flex items-center justify-center w-[24px] h-[24px] p-0 border-0 bg-transparent text-foreground cursor-pointer hover:bg-muted/10 rounded-sm focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--vscode-focusBorder)]"

const TaskHeader: React.FC<TaskHeaderProps> = ({
	task,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	totalCost,
	lastApiReqTotalTokens,
	lastProgressMessageText,
	onClose,
	onScrollToMessage,
	onSendMessage,
}) => {
	const {
		apiConfiguration,
		currentTaskItem,
		checkpointManagerErrorMessage,
		aihydroMessages,
		navigateToSettings,
		useAutoCondense,
		mode,
		expandTaskHeader: isTaskExpanded,
		setExpandTaskHeader: setIsTaskExpanded,
		environment,
	} = useExtensionState()

	// Simplified computed values
	const { selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, mode)
	const modeFields = getModeSpecificFields(apiConfiguration, mode)

	const isCostAvailable =
		(totalCost &&
			modeFields.apiProvider === "openai" &&
			modeFields.openAiModelInfo?.inputPrice &&
			modeFields.openAiModelInfo?.outputPrice) ||
		(modeFields.apiProvider !== "vscode-lm" && modeFields.apiProvider !== "ollama" && modeFields.apiProvider !== "lmstudio")

	// Event handlers
	const toggleTaskExpanded = useCallback(() => setIsTaskExpanded(!isTaskExpanded), [setIsTaskExpanded, isTaskExpanded])

	const handleCheckpointSettingsClick = useCallback(() => {
		navigateToSettings()
		setTimeout(async () => {
			try {
				await UiServiceClient.scrollToSettings(StringRequest.create({ value: "features" }))
			} catch (error) {
				console.error("Error scrolling to checkpoint settings:", error)
			}
		}, 300)
	}, [navigateToSettings])

	const highlightedText = useMemo(() => highlightText(task.text, false), [task.text])
	const environmentBorderColor = getEnvironmentColor(environment, "border")

	return (
		<div className={"p-2 flex flex-col gap-1.5"}>
			{/* Display Checkpoint Error */}
			<CheckpointError
				checkpointManagerErrorMessage={checkpointManagerErrorMessage}
				handleCheckpointSettingsClick={handleCheckpointSettingsClick}
			/>
			{/* Task Header */}
			<div
				className={cn(
					"task-header-card relative overflow-hidden cursor-pointer flex flex-col gap-1.5 z-10 pt-2 pb-2 px-2",
					isTaskExpanded ? "task-header-card--expanded" : "",
				)}
				style={{
					borderColor: environmentBorderColor,
				}}>
				{/* Task Title. Wraps rather than overlaps: the controls and chips drop to a second row when the sidebar is narrow. */}
				<div className="flex flex-wrap items-center gap-x-1 gap-y-1" data-testid="task-header-row">
					<div className="flex items-center shrink-0">
						<button
							aria-expanded={isTaskExpanded}
							aria-label={isTaskExpanded ? "Hide task details" : "Show task details"}
							className={ICON_BUTTON_CLASS}
							onClick={toggleTaskExpanded}
							title={isTaskExpanded ? "Hide task details" : "Show task details"}
							type="button">
							{isTaskExpanded ? <ChevronDownIcon size="16" /> : <ChevronRightIcon size="16" />}
						</button>
						{isTaskExpanded && (
							<div className="flex items-center opacity-80">
								<CopyTaskButton className={BUTTON_CLASS} taskText={task.text} />
								<DeleteTaskButton
									className={BUTTON_CLASS}
									taskId={currentTaskItem?.id}
									taskSize={currentTaskItem?.size}
								/>
								{/* Only visible in development mode */}
								{IS_DEV && (
									<OpenDiskConversationHistoryButton className={BUTTON_CLASS} taskId={currentTaskItem?.id} />
								)}
							</div>
						)}
					</div>
					{!isTaskExpanded && (
						// A mouse convenience on the text only; the chevron button is the keyboard and screen-reader control.
						<div
							className="text-sm whitespace-nowrap overflow-hidden text-ellipsis flex-1 min-w-[5rem] select-none cursor-pointer"
							onClick={toggleTaskExpanded}>
							<span className="ph-no-capture">{highlightText(task.text, false)}</span>
						</div>
					)}
					<div className="flex flex-wrap items-center justify-end gap-1 ml-auto min-w-0 max-w-full select-none">
						<StudyChip />
						{isCostAvailable && (
							<div className="task-header-chip shrink-0" id="price-tag" title="Cost of this task so far">
								<span className="codicon codicon-credit-card text-[10px] opacity-70"></span>
								<span>${totalCost?.toFixed(4)}</span>
							</div>
						)}
						<NewTaskButton className={BUTTON_CLASS} onClick={onClose} />
					</div>
				</div>

				<StudyPickerPanel />

				{/* Expand/Collapse Task Details */}
				{isTaskExpanded && (
					<div className="flex flex-col break-words" key={`task-details-${currentTaskItem?.id}`}>
						<div className="whitespace-nowrap overflow-hidden text-ellipsis flex-grow min-w-0 max-h-20 overflow-y-auto scroll-smooth">
							<div
								className={
									"ph-no-capture overflow-hidden whitespace-pre-wrap break-words px-0.5 text-sm cursor-pointer mt-1"
								}>
								{highlightedText}
							</div>
						</div>

						{((task.images && task.images.length > 0) || (task.files && task.files.length > 0)) && (
							<Thumbnails files={task.files ?? []} images={task.images ?? []} />
						)}

						<ContextWindow
							cacheReads={cacheReads}
							cacheWrites={cacheWrites}
							contextWindow={selectedModelInfo?.contextWindow}
							lastApiReqTotalTokens={lastApiReqTotalTokens}
							onSendMessage={onSendMessage}
							tokensIn={tokensIn}
							tokensOut={tokensOut}
							totalCost={totalCost}
							useAutoCondense={false} // Disable auto-condense configuration in UI for now
						/>

						<TaskTimeline messages={aihydroMessages} onBlockClick={onScrollToMessage} />
					</div>
				)}
			</div>

			{/* Display Focus Chain To-Do List */}
			<FocusChain currentTaskItemId={currentTaskItem?.id} lastProgressMessageText={lastProgressMessageText} />
		</div>
	)
}

export default TaskHeader
