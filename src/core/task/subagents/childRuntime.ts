import { Anthropic } from "@anthropic-ai/sdk"
import type { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { MessageStateHandler } from "../message-state"
import { TaskState } from "../TaskState"

/**
 * A child's message state lives in memory only. The parent's MessageStateHandler writes to the task directory and
 * updates the task history item on every change; a child must do neither (it holds no task lock and writes no history).
 * Its full transcript goes to the child record instead.
 */
export class ChildMessageState extends MessageStateHandler {
	constructor(taskId: string, ulid: string, taskState: TaskState) {
		super({ taskId, ulid, taskState, updateTaskHistory: async () => [] })
	}

	override async saveAiHydroMessagesAndUpdateHistory(): Promise<void> {}

	override async addToApiConversationHistory(message: Anthropic.MessageParam): Promise<void> {
		this.getApiConversationHistory().push(message)
	}

	override async overwriteApiConversationHistory(newHistory: Anthropic.MessageParam[]): Promise<void> {
		this.setApiConversationHistory(newHistory)
	}

	override async overwriteAiHydroMessages(newMessages: AiHydroMessage[]): Promise<void> {
		this.setAiHydroMessages(newMessages)
	}
}

/**
 * Handlers record "this file entered the model's context" on the task's tracker, which persists to the parent's task
 * metadata and watches the file. A child's reads never entered the PARENT's context, so they must not be recorded there.
 */
export function nullFileContextTracker(taskId: string): FileContextTracker {
	return {
		taskId,
		trackFileContext: async () => {},
		setupFileWatcher: async () => {},
		markFileAsEditedByAiHydro: () => {},
		getAndClearRecentlyModifiedFiles: () => [],
		getAndClearCheckpointModifiedFiles: () => [],
		detectFilesEditedAfterMessage: async () => [],
		dispose: async () => {},
	} as unknown as FileContextTracker
}

export function newChildTaskState(): TaskState {
	return new TaskState()
}
