import type { CommandPolicyClass } from "@shared/aihydro/commandEvidence"
import { INFO_CLASS_SEVERITY, INFO_CLASSES, type InfoNotice, type McpNotificationLevel } from "@shared/aihydro/infoNotice"
import { parseSubagentOrigin } from "@shared/aihydro/subagents"
import {
	AiHydroAsk as AppAiHydroAsk,
	AiHydroMessage as AppAiHydroMessage,
	AiHydroSay as AppAiHydroSay,
} from "@shared/ExtensionMessage"

import { ClineAsk, ClineMessageType, ClineSay, ClineMessage as ProtoClineMessage } from "@shared/proto/cline/ui"

// Helper function to convert AiHydroAsk string to proto ClineAsk enum
function convertAiHydroAskToProtoEnum(ask: AppAiHydroAsk | undefined): ClineAsk | undefined {
	if (!ask) {
		return undefined
	}

	const mapping: Record<AppAiHydroAsk, ClineAsk> = {
		followup: ClineAsk.FOLLOWUP,
		plan_mode_respond: ClineAsk.PLAN_MODE_RESPOND,
		command: ClineAsk.COMMAND,
		command_output: ClineAsk.COMMAND_OUTPUT,
		completion_result: ClineAsk.COMPLETION_RESULT,
		tool: ClineAsk.TOOL,
		api_req_failed: ClineAsk.API_REQ_FAILED,
		resume_task: ClineAsk.RESUME_TASK,
		resume_completed_task: ClineAsk.RESUME_COMPLETED_TASK,
		mistake_limit_reached: ClineAsk.MISTAKE_LIMIT_REACHED,
		auto_approval_max_req_reached: ClineAsk.AUTO_APPROVAL_MAX_REQ_REACHED,
		browser_action_launch: ClineAsk.BROWSER_ACTION_LAUNCH,
		use_mcp_server: ClineAsk.USE_MCP_SERVER,
		install_dependencies: ClineAsk.INSTALL_DEPENDENCIES,
		workspace_env_setup: ClineAsk.WORKSPACE_ENV_SETUP,
		new_task: ClineAsk.NEW_TASK,
		condense: ClineAsk.CONDENSE,
		summarize_task: ClineAsk.SUMMARIZE_TASK,
		report_bug: ClineAsk.REPORT_BUG,
	}

	const result = mapping[ask]
	if (result === undefined) {
		console.warn(`Unknown AiHydroAsk value: ${ask}`)
	}
	return result
}

// Helper function to convert proto ClineAsk enum to AiHydroAsk string
function convertProtoEnumToAiHydroAsk(ask: ClineAsk): AppAiHydroAsk | undefined {
	if (ask === ClineAsk.UNRECOGNIZED) {
		console.warn("Received UNRECOGNIZED ClineAsk enum value")
		return undefined
	}

	const mapping: Record<Exclude<ClineAsk, ClineAsk.UNRECOGNIZED>, AppAiHydroAsk> = {
		[ClineAsk.FOLLOWUP]: "followup",
		[ClineAsk.PLAN_MODE_RESPOND]: "plan_mode_respond",
		[ClineAsk.COMMAND]: "command",
		[ClineAsk.COMMAND_OUTPUT]: "command_output",
		[ClineAsk.COMPLETION_RESULT]: "completion_result",
		[ClineAsk.TOOL]: "tool",
		[ClineAsk.API_REQ_FAILED]: "api_req_failed",
		[ClineAsk.RESUME_TASK]: "resume_task",
		[ClineAsk.RESUME_COMPLETED_TASK]: "resume_completed_task",
		[ClineAsk.MISTAKE_LIMIT_REACHED]: "mistake_limit_reached",
		[ClineAsk.AUTO_APPROVAL_MAX_REQ_REACHED]: "auto_approval_max_req_reached",
		[ClineAsk.BROWSER_ACTION_LAUNCH]: "browser_action_launch",
		[ClineAsk.USE_MCP_SERVER]: "use_mcp_server",
		[ClineAsk.NEW_TASK]: "new_task",
		[ClineAsk.CONDENSE]: "condense",
		[ClineAsk.SUMMARIZE_TASK]: "summarize_task",
		[ClineAsk.REPORT_BUG]: "report_bug",
		[ClineAsk.INSTALL_DEPENDENCIES]: "install_dependencies",
		[ClineAsk.WORKSPACE_ENV_SETUP]: "workspace_env_setup",
	}

	return mapping[ask]
}

// Helper function to convert AiHydroSay string to proto ClineSay enum
function convertAiHydroSayToProtoEnum(say: AppAiHydroSay | undefined): ClineSay | undefined {
	if (!say) {
		return undefined
	}

	const mapping: Record<AppAiHydroSay, ClineSay> = {
		task: ClineSay.TASK,
		error: ClineSay.ERROR,
		api_req_started: ClineSay.API_REQ_STARTED,
		api_req_finished: ClineSay.API_REQ_FINISHED,
		text: ClineSay.TEXT,
		reasoning: ClineSay.REASONING,
		completion_result: ClineSay.COMPLETION_RESULT_SAY,
		user_feedback: ClineSay.USER_FEEDBACK,
		user_feedback_diff: ClineSay.USER_FEEDBACK_DIFF,
		api_req_retried: ClineSay.API_REQ_RETRIED,
		command: ClineSay.COMMAND_SAY,
		command_output: ClineSay.COMMAND_OUTPUT_SAY,
		tool: ClineSay.TOOL_SAY,
		shell_integration_warning: ClineSay.SHELL_INTEGRATION_WARNING,
		shell_integration_warning_with_suggestion: ClineSay.SHELL_INTEGRATION_WARNING_WITH_SUGGESTION,
		browser_action_launch: ClineSay.BROWSER_ACTION_LAUNCH_SAY,
		browser_action: ClineSay.BROWSER_ACTION,
		browser_action_result: ClineSay.BROWSER_ACTION_RESULT,
		mcp_server_request_started: ClineSay.MCP_SERVER_REQUEST_STARTED,
		mcp_server_response: ClineSay.MCP_SERVER_RESPONSE,
		mcp_notification: ClineSay.MCP_NOTIFICATION,
		use_mcp_server: ClineSay.USE_MCP_SERVER_SAY,
		diff_error: ClineSay.DIFF_ERROR,
		deleted_api_reqs: ClineSay.DELETED_API_REQS,
		aihydroignore_error: ClineSay.CLINEIGNORE_ERROR,
		checkpoint_created: ClineSay.CHECKPOINT_CREATED,
		load_mcp_documentation: ClineSay.LOAD_MCP_DOCUMENTATION,
		info: ClineSay.INFO,
		html_preview: ClineSay.HTML_PREVIEW,
		answer_audit: ClineSay.ANSWER_AUDIT,
		task_progress: ClineSay.TASK_PROGRESS,
		error_retry: ClineSay.ERROR_RETRY,
		subagent_status: ClineSay.SUBAGENT_STATUS,
	}

	const result = mapping[say]
	if (result === undefined) {
		console.warn(`Unknown AiHydroSay value: ${say}`)
	}
	return result
}

// Helper function to convert proto ClineSay enum to AiHydroSay string
function convertProtoEnumToAiHydroSay(say: ClineSay): AppAiHydroSay | undefined {
	if (say === ClineSay.UNRECOGNIZED) {
		console.warn("Received UNRECOGNIZED ClineSay enum value")
		return undefined
	}

	const mapping: Record<Exclude<ClineSay, ClineSay.UNRECOGNIZED>, AppAiHydroSay> = {
		[ClineSay.TASK]: "task",
		[ClineSay.ERROR]: "error",
		[ClineSay.API_REQ_STARTED]: "api_req_started",
		[ClineSay.API_REQ_FINISHED]: "api_req_finished",
		[ClineSay.TEXT]: "text",
		[ClineSay.REASONING]: "reasoning",
		[ClineSay.COMPLETION_RESULT_SAY]: "completion_result",
		[ClineSay.USER_FEEDBACK]: "user_feedback",
		[ClineSay.USER_FEEDBACK_DIFF]: "user_feedback_diff",
		[ClineSay.API_REQ_RETRIED]: "api_req_retried",
		[ClineSay.COMMAND_SAY]: "command",
		[ClineSay.COMMAND_OUTPUT_SAY]: "command_output",
		[ClineSay.TOOL_SAY]: "tool",
		[ClineSay.SHELL_INTEGRATION_WARNING]: "shell_integration_warning",
		[ClineSay.BROWSER_ACTION_LAUNCH_SAY]: "browser_action_launch",
		[ClineSay.BROWSER_ACTION]: "browser_action",
		[ClineSay.BROWSER_ACTION_RESULT]: "browser_action_result",
		[ClineSay.MCP_SERVER_REQUEST_STARTED]: "mcp_server_request_started",
		[ClineSay.MCP_SERVER_RESPONSE]: "mcp_server_response",
		[ClineSay.MCP_NOTIFICATION]: "mcp_notification",
		[ClineSay.USE_MCP_SERVER_SAY]: "use_mcp_server",
		[ClineSay.DIFF_ERROR]: "diff_error",
		[ClineSay.DELETED_API_REQS]: "deleted_api_reqs",
		[ClineSay.CLINEIGNORE_ERROR]: "aihydroignore_error",
		[ClineSay.CHECKPOINT_CREATED]: "checkpoint_created",
		[ClineSay.LOAD_MCP_DOCUMENTATION]: "load_mcp_documentation",
		[ClineSay.INFO]: "info",
		[ClineSay.TASK_PROGRESS]: "task_progress",
		[ClineSay.ERROR_RETRY]: "error_retry",
		[ClineSay.HTML_PREVIEW]: "html_preview",
		[ClineSay.ANSWER_AUDIT]: "answer_audit",
		[ClineSay.SUBAGENT_STATUS]: "subagent_status",
		[ClineSay.SHELL_INTEGRATION_WARNING_WITH_SUGGESTION]: "shell_integration_warning_with_suggestion",
	}

	return mapping[say]
}

/**
 * Convert application AiHydroMessage to proto ClineMessage
 */
export function convertAiHydroMessageToProto(message: AppAiHydroMessage): ProtoClineMessage {
	// For sending messages, we need to provide values for required proto fields
	const askEnum = message.ask ? convertAiHydroAskToProtoEnum(message.ask) : undefined
	const sayEnum = message.say ? convertAiHydroSayToProtoEnum(message.say) : undefined

	// Determine appropriate enum values based on message type
	let finalAskEnum: ClineAsk = ClineAsk.FOLLOWUP // Proto default
	let finalSayEnum: ClineSay = ClineSay.TEXT // Proto default

	if (message.type === "ask") {
		finalAskEnum = askEnum ?? ClineAsk.FOLLOWUP // Use FOLLOWUP as default for ask messages
	} else if (message.type === "say") {
		finalSayEnum = sayEnum ?? ClineSay.TEXT // Use TEXT as default for say messages
	}

	const protoMessage: ProtoClineMessage = {
		ts: message.ts,
		type: message.type === "ask" ? ClineMessageType.ASK : ClineMessageType.SAY,
		ask: finalAskEnum,
		say: finalSayEnum,
		text: message.text ?? "",
		reasoning: message.reasoning ?? "",
		images: message.images ?? [],
		files: message.files ?? [],
		partial: message.partial ?? false,
		lastCheckpointHash: message.lastCheckpointHash ?? "",
		isCheckpointCheckedOut: message.isCheckpointCheckedOut ?? false,
		isOperationOutsideWorkspace: message.isOperationOutsideWorkspace ?? false,
		conversationHistoryIndex: message.conversationHistoryIndex ?? 0,
		conversationHistoryDeletedRange: message.conversationHistoryDeletedRange
			? {
					startIndex: message.conversationHistoryDeletedRange[0],
					endIndex: message.conversationHistoryDeletedRange[1],
				}
			: undefined,
		// Additional optional fields for specific ask/say types
		sayTool: undefined,
		sayBrowserAction: undefined,
		browserActionResult: undefined,
		askUseMcpServer: undefined,
		planModeResponse: undefined,
		askQuestion: undefined,
		askNewTask: undefined,
		apiReqInfo: undefined,
		infoClass: message.infoNotice?.class ?? "",
		infoSeverity: message.infoNotice?.severity ?? "",
		infoDetailJson: message.infoNotice?.detail ? JSON.stringify(message.infoNotice.detail) : "",
		mcpLevel: message.mcpLevel ?? "",
		exitCodeState: message.exitCode === undefined ? "" : message.exitCode === "unknown" ? "unknown" : "known",
		exitCode: typeof message.exitCode === "number" ? message.exitCode : 0,
		policyClass: message.policyClass ?? "",
		subagentOriginJson: message.subagentOrigin ? JSON.stringify(message.subagentOrigin) : "",
		// Outcome evidence the host records; empty/false = absent (the readers treat both the same way).
		askOutcome: message.askOutcome ?? "",
		execOutcome: message.execOutcome ?? "",
		commandCompleted: message.commandCompleted === true,
		followUpAnswer: message.followUpAnswer === true,
	}

	return protoMessage
}

/**
 * Convert proto ClineMessage to application AiHydroMessage
 */
export function convertProtoToAiHydroMessage(protoMessage: ProtoClineMessage): AppAiHydroMessage {
	const message: AppAiHydroMessage = {
		ts: protoMessage.ts,
		type: protoMessage.type === ClineMessageType.ASK ? "ask" : "say",
	}

	// Convert ask enum to string
	if (protoMessage.type === ClineMessageType.ASK) {
		const ask = convertProtoEnumToAiHydroAsk(protoMessage.ask)
		if (ask !== undefined) {
			message.ask = ask
		}
	}

	// Convert say enum to string
	if (protoMessage.type === ClineMessageType.SAY) {
		const say = convertProtoEnumToAiHydroSay(protoMessage.say)
		if (say !== undefined) {
			message.say = say
		}
	}

	// Convert other fields - preserve empty strings as they may be intentional
	if (protoMessage.text !== "") {
		message.text = protoMessage.text
	}
	if (protoMessage.reasoning !== "") {
		message.reasoning = protoMessage.reasoning
	}
	if (protoMessage.images.length > 0) {
		message.images = protoMessage.images
	}
	if (protoMessage.files.length > 0) {
		message.files = protoMessage.files
	}
	if (protoMessage.partial) {
		message.partial = protoMessage.partial
	}
	if (protoMessage.lastCheckpointHash !== "") {
		message.lastCheckpointHash = protoMessage.lastCheckpointHash
	}
	if (protoMessage.askOutcome === "approved" || protoMessage.askOutcome === "denied") {
		message.askOutcome = protoMessage.askOutcome
	}
	if (
		protoMessage.execOutcome === "completed" ||
		protoMessage.execOutcome === "failed" ||
		protoMessage.execOutcome === "unknown"
	) {
		message.execOutcome = protoMessage.execOutcome
	}
	if (protoMessage.commandCompleted) {
		message.commandCompleted = true
	}
	if (protoMessage.followUpAnswer) {
		message.followUpAnswer = true
	}
	if (protoMessage.isCheckpointCheckedOut) {
		message.isCheckpointCheckedOut = protoMessage.isCheckpointCheckedOut
	}
	if (protoMessage.isOperationOutsideWorkspace) {
		message.isOperationOutsideWorkspace = protoMessage.isOperationOutsideWorkspace
	}
	if (protoMessage.conversationHistoryIndex !== 0) {
		message.conversationHistoryIndex = protoMessage.conversationHistoryIndex
	}

	// Convert conversationHistoryDeletedRange from object to tuple
	if (protoMessage.conversationHistoryDeletedRange) {
		message.conversationHistoryDeletedRange = [
			protoMessage.conversationHistoryDeletedRange.startIndex,
			protoMessage.conversationHistoryDeletedRange.endIndex,
		]
	}

	// AI-Hydro host evidence: only set when recorded, so old tasks stay byte-identical.
	if (protoMessage.infoClass !== "") {
		// Trust the class over the stored severity; an unknown class with an empty or garbled severity is a warning,
		// so only a known informational class (native_call_repaired) can fold.
		const known = (INFO_CLASSES as readonly string[]).includes(protoMessage.infoClass)
		const notice: InfoNotice = {
			class: protoMessage.infoClass as InfoNotice["class"],
			severity: known
				? INFO_CLASS_SEVERITY[protoMessage.infoClass as InfoNotice["class"]]
				: protoMessage.infoSeverity === "info"
					? "info"
					: "warning",
		}
		if (protoMessage.infoDetailJson !== "") {
			try {
				notice.detail = JSON.parse(protoMessage.infoDetailJson)
			} catch {
				// a malformed detail never hides the notice itself
			}
		}
		message.infoNotice = notice
	}
	if (protoMessage.mcpLevel !== "") {
		message.mcpLevel = protoMessage.mcpLevel as McpNotificationLevel
	}
	if (protoMessage.exitCodeState === "known") {
		message.exitCode = protoMessage.exitCode
	} else if (protoMessage.exitCodeState === "unknown") {
		message.exitCode = "unknown"
	}
	if (protoMessage.policyClass !== "") {
		message.policyClass = protoMessage.policyClass as CommandPolicyClass
	}
	if (protoMessage.subagentOriginJson !== "") {
		const origin = parseSubagentOrigin(protoMessage.subagentOriginJson)
		if (origin) {
			message.subagentOrigin = origin
		}
	}

	return message
}
