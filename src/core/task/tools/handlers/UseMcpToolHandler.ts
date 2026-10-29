import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { infoNoticeFor, type McpNotificationLevel } from "@shared/aihydro/infoNotice"
import { AiHydroAsk, AiHydroAskUseMcpServer } from "@shared/ExtensionMessage"
import { buildAiHydroCallContext } from "@/core/mcp/aihydroContext"
import { resolveWorkspaceRoot } from "@/core/mcp/workspaceRoot"
import { notifyApprovalRequired } from "@/integrations/aihydro-session/approvalTerminal"
import { telemetryService } from "@/services/telemetry"
import { AiHydroDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import { mcpAutoApproveDecision, mcpConnectionIdentity } from "../mcpAutoApprove"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import { repairMcpArgumentsString } from "../ToolInputRepair"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"
import { hostAudienceRefusal, isAiHydroServerName, isHostAudienceTool } from "./aiHydroServer"
import { checkMcpToolName } from "./mcpToolNameValidation"

export class UseMcpToolHandler implements IFullyManagedTool {
	readonly name = AiHydroDefaultTool.MCP_USE

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.server_name}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const server_name = block.params.server_name
		const tool_name = block.params.tool_name
		const mcp_arguments = block.params.arguments

		const partialMessage = JSON.stringify({
			type: "use_mcp_tool",
			serverName: uiHelpers.removeClosingTag(block, "server_name", server_name),
			toolName: uiHelpers.removeClosingTag(block, "tool_name", tool_name),
			arguments: uiHelpers.removeClosingTag(block, "arguments", mcp_arguments),
		} satisfies AiHydroAskUseMcpServer)

		// Check if tool should be auto-approved using MCP-specific logic
		const config = uiHelpers.getConfig()
		// Only show the auto-approved row when the call would really auto-run (grant passes the run-time recheck),
		// so a call that ends up asking never flashes as approved.
		const shouldAutoApprove =
			config.callbacks.shouldAutoApproveTool(block.name) &&
			mcpAutoApproveDecision(config.services.mcpHub, server_name, tool_name).auto

		if (shouldAutoApprove) {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "use_mcp_server")
			await uiHelpers.say("use_mcp_server" as any, partialMessage, undefined, undefined, block.partial)
		} else {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "use_mcp_server")
			await uiHelpers.ask("use_mcp_server" as AiHydroAsk, partialMessage, block.partial).catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const server_name: string | undefined = block.params.server_name
		const tool_name: string | undefined = block.params.tool_name
		const mcp_arguments: string | undefined = block.params.arguments

		// Validate required parameters
		if (!server_name) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "server_name")
		}

		if (!tool_name) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "tool_name")
		}

		// Validate the target BEFORE any approval ask: the user must never be asked to approve (or wait on) a call
		// that cannot succeed. The model gets the structured error; the user sees at most one muted line.
		const targetCheck = checkMcpToolName(config.services.mcpHub.connections, server_name, tool_name)
		if (!targetCheck.ok) {
			config.taskState.consecutiveMistakeCount++
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "use_mcp_server")
			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "use_mcp_server")
			await config.callbacks.say(
				"info",
				targetCheck.reason === "unknown_tool"
					? `Skipped: '${tool_name}' is not a tool on '${server_name}'. Asked the model to retry.`
					: `Skipped: MCP server '${server_name}' is not connected. Asked the model to retry.`,
				undefined,
				undefined,
				undefined,
				{ infoNotice: infoNoticeFor(targetCheck.reason === "unknown_tool" ? "unknown_tool" : "server_not_connected") },
			)
			return formatResponse.toolError(targetCheck.message)
		}

		// Host-audience tools (the project registry: confirm a default study, rename, link) are the extension's to call.
		// The server hides them from discovery but does not enforce that, so a model that names one is refused here,
		// before any approval ask and before the server is reached.
		if (isHostAudienceTool(config.services.mcpHub.connections, server_name, tool_name)) {
			config.taskState.consecutiveMistakeCount++
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "use_mcp_server")
			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "use_mcp_server")
			await config.callbacks.say("info", `Skipped: '${tool_name}' is a host operation, not an agent tool.`)
			return formatResponse.toolError(hostAudienceRefusal(tool_name))
		}

		// Parse and validate arguments if provided. Weaker models often emit
		// near-miss JSON (code fences, stringified arrays, explicit nulls, wrapper
		// objects); repair against the tool's input schema before counting a mistake.
		let parsedArguments: Record<string, unknown> | undefined
		if (mcp_arguments) {
			const toolSchema = config.services.mcpHub.connections
				?.find((conn: any) => conn.server.name === server_name)
				?.server.tools?.find((tool: any) => tool.name === tool_name)?.inputSchema
			const { value: repairedArguments, repairs } = repairMcpArgumentsString(mcp_arguments, toolSchema)
			try {
				parsedArguments = JSON.parse(repairedArguments)
				if (repairs.length > 0) {
					telemetryService.captureToolInputRepaired(
						config.ulid,
						block.name,
						config.api.getModel().id,
						repairs.map((r) => r.kind),
					)
				}
			} catch (_error) {
				config.taskState.consecutiveMistakeCount++
				telemetryService.captureToolInputInvalid(config.ulid, block.name, config.api.getModel().id, "json_parse_failed")
				await config.callbacks.say(
					"error",
					`AI-Hydro tried to use ${tool_name} with an invalid JSON argument. Retrying...`,
				)
				return formatResponse.toolError(formatResponse.invalidMcpToolArgumentError(server_name, tool_name))
			}
		}

		config.taskState.consecutiveMistakeCount = 0

		// Handle approval flow. A stored grant is rechecked against the live connection (M-3); a paused one asks,
		// and the ask says why.
		const autoDecision = mcpAutoApproveDecision(config.services.mcpHub, server_name, tool_name)
		const completeMessage = JSON.stringify({
			type: "use_mcp_tool",
			serverName: server_name,
			toolName: tool_name,
			arguments: mcp_arguments,
			...(autoDecision.auto === false && autoDecision.granted ? { autoApprovePaused: autoDecision.pausedText } : {}),
		} satisfies AiHydroAskUseMcpServer)

		const isToolAutoApproved = autoDecision.auto
		// The connection this decision (or the user's approval) applies to; rechecked right before callTool.
		const boundIdentity = mcpConnectionIdentity(config.services.mcpHub, server_name)

		if (config.callbacks.shouldAutoApproveTool(block.name) && isToolAutoApproved) {
			// Auto-approval flow
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "use_mcp_server")
			await config.callbacks.say("use_mcp_server", completeMessage, undefined, undefined, false)
			if (!config.yoloModeToggled) {
				config.taskState.consecutiveAutoApprovedRequestsCount++
			}

			// Capture telemetry
			telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, true, true)
		} else {
			// Manual approval flow
			const notificationMessage = `AI-Hydro wants to use ${tool_name || "unknown tool"} on ${server_name || "unknown server"}`

			// Show notification
			showNotificationForApprovalIfAutoApprovalEnabled(
				notificationMessage,
				config.autoApprovalSettings.enabled,
				config.autoApprovalSettings.enableNotifications,
			)

			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "use_mcp_server")

			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("use_mcp_server", completeMessage, config)
			if (!didApprove) {
				telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, false)
				return formatResponse.toolDenied()
			} else {
				telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, true)
			}
		}

		// Show MCP request started message
		await config.callbacks.say("mcp_server_request_started")

		try {
			// Check for any pending notifications before the tool call
			const notificationsBefore = config.services.mcpHub.getPendingNotifications()
			for (const notification of notificationsBefore) {
				await config.callbacks.say(
					"mcp_notification",
					`[${notification.serverName}] ${notification.message}`,
					undefined,
					undefined,
					undefined,
					{ mcpLevel: notification.level as McpNotificationLevel },
				)
			}

			// Wave 3 Axis 3 + Design A: inject _chat_id + _workspace into every
			// ai-hydro MCP tool call so the Python session resolver can bind this
			// chat ↔ study and auto-set workspace_dir for file outputs.
			// Both fields are stripped server-side before reaching any tool parameter;
			// they never appear in tool schemas or LLM context. See isAiHydroServerName
			// for why this matches the whole server-name family, not a single literal.
			let argsWithChatId = parsedArguments
			let callMeta: Record<string, unknown> | undefined
			if (isAiHydroServerName(server_name) && config.ulid) {
				// Workspace: HostProvider workspace folder, falling back to the task cwd.
				const workspaceRoot = await resolveWorkspaceRoot(config.cwd)
				// Also sent as MCP request _meta["aihydro/context"]; the legacy
				// arguments stay for one release (slice 2 P4 / ADR-004 amendment).
				const callContext = buildAiHydroCallContext(
					parsedArguments,
					config.ulid,
					workspaceRoot,
					config.taskState.lastResponseModelId,
					// X1-P1: `_meta.project_id` for the chat's project, when it has one.
					config.services.controller?.getChatProjectId(config.ulid),
				)
				argsWithChatId = callContext.args
				callMeta = callContext.meta
			}

			// N1: callTool looks the connection up again by name. If it is no longer the one that was decided on (or
			// approved), an auto-run asks first, and an approval given for the old one is void. No await between this
			// check and the call.
			if (mcpConnectionIdentity(config.services.mcpHub, server_name) !== boundIdentity) {
				if (!isToolAutoApproved) {
					return formatResponse.toolError(
						`The MCP server '${server_name}' changed after you approved this call (it was restarted with a different launch configuration), so '${tool_name}' was not run. Ask again to retry.`,
					)
				}
				const reask = JSON.stringify({
					type: "use_mcp_tool",
					serverName: server_name,
					toolName: tool_name,
					arguments: mcp_arguments,
					autoApprovePaused: `Always for ${tool_name} is paused: the server changed while this call was being prepared.`,
				} satisfies AiHydroAskUseMcpServer)
				const askedAbout = mcpConnectionIdentity(config.services.mcpHub, server_name)
				if (askedAbout === undefined) {
					return formatResponse.toolError(`The MCP server '${server_name}' is no longer connected.`)
				}
				if (!(await ToolResultUtils.askApprovalAndPushFeedback("use_mcp_server", reask, config))) {
					return formatResponse.toolDenied()
				}
				if (mcpConnectionIdentity(config.services.mcpHub, server_name) !== askedAbout) {
					return formatResponse.toolError(
						`The MCP server '${server_name}' changed again after you approved this call, so '${tool_name}' was not run.`,
					)
				}
			}

			// Execute the MCP tool
			const toolResult = await config.services.mcpHub.callTool(
				server_name,
				tool_name,
				argsWithChatId,
				config.ulid,
				callMeta,
			)

			// Check for any pending notifications after the tool call
			const notificationsAfter = config.services.mcpHub.getPendingNotifications()
			for (const notification of notificationsAfter) {
				await config.callbacks.say(
					"mcp_notification",
					`[${notification.serverName}] ${notification.message}`,
					undefined,
					undefined,
					undefined,
					{ mcpLevel: notification.level as McpNotificationLevel },
				)
			}

			// Process tool result
			const toolResultImages =
				toolResult?.content
					.filter((item: any) => item.type === "image")
					.map((item: any) => `data:${item.mimeType};base64,${item.data}`) || []

			let toolResultText =
				(toolResult?.isError ? "Error:\n" : "") +
					toolResult?.content
						.map((item: any) => {
							if (item.type === "text") {
								return item.text
							}
							if (item.type === "resource") {
								const { blob: _blob, ...rest } = item.resource
								return JSON.stringify(rest, null, 2)
							}
							return ""
						})
						.filter(Boolean)
						.join("\n\n") || "(No response)"

			// ADR-002b A4: an APPROVAL_REQUIRED refusal offers "Approve in
			// terminal" (types the command; the human presses Enter). No signing here.
			notifyApprovalRequired(
				toolResultText,
				config.services.mcpHub.connections?.find((conn: any) => conn.server.name === server_name)?.server,
			)

			// X0-2: a binding change or failed resolution reported by the server updates the study chip. Shape only.
			config.services.controller?.observeStudyBindingSignal?.(server_name, toolResultText)

			// webview extracts images from the text response to display in the UI
			const toolResultToDisplay = toolResultText + toolResultImages?.map((image: any) => `\n\n${image}`).join("")
			await config.callbacks.say("mcp_server_response", toolResultToDisplay)

			// Handle model image support
			const supportsImages = config.api.getModel().info.supportsImages ?? false
			if (toolResultImages.length > 0 && !supportsImages) {
				toolResultText += `\n\n[${toolResultImages.length} images were provided in the response, and while they are displayed to the user, you do not have the ability to view them.]`
			}

			// Return formatted result (only pass images if model supports them)
			return formatResponse.toolResult(toolResultText, supportsImages ? toolResultImages : undefined)
		} catch (error) {
			return `Error executing MCP tool: ${(error as Error)?.message}`
		}
	}
}
