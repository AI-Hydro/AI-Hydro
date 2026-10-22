import {
	alwaysAllowReasonText,
	alwaysAllowVerdict,
	describeAutoApproveRefusal,
	parseAutoApproveRefusal,
} from "@shared/aihydro/alwaysAllowPolicy"
import { McpTool } from "@shared/mcp"
import { ToggleToolAutoApproveRequest } from "@shared/proto/cline/mcp"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"

type McpToolRowProps = {
	tool: McpTool
	serverName?: string
	/** The host's trust verdict for the server (McpServer.trust?.trusted) and its connection state. */
	serverTrusted?: boolean
	serverConnected?: boolean
	/** The server's listed tools, for the duplicate-name check in the verdict. */
	serverTools?: McpTool[]
	// In the chat transcript we want a slim row: the full tool description and the
	// parameter schema are noise there (the actual call arguments render separately).
	compact?: boolean
}

const McpToolRow = ({ tool, serverName, serverTrusted, serverConnected, serverTools, compact = false }: McpToolRowProps) => {
	const { autoApprovalSettings } = useExtensionState()

	const { setMcpServers } = useExtensionState()
	const [refusal, setRefusal] = useState<string | undefined>()

	// Mirrors the host's refusal (McpHub.toggleToolAutoApproveRPC): the host decides, this only avoids offering
	// a request it would refuse. Unchecking is always allowed.
	const verdict = alwaysAllowVerdict({
		serverTrusted: serverTrusted === true,
		serverConnected: serverConnected !== false,
		tools: serverTools ?? [tool],
		toolName: tool.name,
	})
	const addBlocked = !tool.autoApprove && !verdict.ok
	const reasonId = `auto-run-reason-${serverName ?? ""}-${tool.name}`
	const blockedReason = !verdict.ok ? alwaysAllowReasonText(verdict.reason) : undefined

	// Accept the event object
	const handleAutoApproveChange = (_event: any) => {
		if (!serverName) {
			return
		}

		setRefusal(undefined)
		McpServiceClient.toggleToolAutoApprove(
			ToggleToolAutoApproveRequest.create({
				serverName,
				toolNames: [tool.name],
				autoApprove: !tool.autoApprove,
			}),
		)
			.then((response) => {
				const mcpServers = convertProtoMcpServersToMcpServers(response.mcpServers)
				setMcpServers(mcpServers)
			})
			.catch((error) => {
				const parsed = parseAutoApproveRefusal(error instanceof Error ? error.message : String(error))
				if (parsed) {
					setRefusal(describeAutoApproveRefusal(parsed))
				} else {
					console.error("Error toggling tool auto-approve", error)
					setRefusal("Could not update auto-run. Nothing was changed.")
				}
			})
	}
	return (
		<div
			key={tool.name}
			style={{
				padding: "3px 0",
			}}>
			<div
				data-testid="tool-row-container"
				onClick={(e) => e.stopPropagation()}
				style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
				<div style={{ display: "flex", alignItems: "center" }}>
					<span className="codicon codicon-symbol-method" style={{ marginRight: "6px" }}></span>
					<span style={{ fontWeight: 500 }}>{tool.name}</span>
				</div>
				{serverName && autoApprovalSettings.enabled && autoApprovalSettings.actions.useMcp && (
					<VSCodeCheckbox
						aria-describedby={addBlocked ? reasonId : undefined}
						checked={tool.autoApprove ?? false}
						data-tool={tool.name}
						disabled={addBlocked}
						onChange={handleAutoApproveChange}
						title={addBlocked ? blockedReason : undefined}>
						Tool auto-run
					</VSCodeCheckbox>
				)}
			</div>
			{addBlocked && blockedReason && (
				<div
					data-testid="auto-run-blocked-reason"
					id={reasonId}
					style={{ marginTop: "4px", opacity: 0.8, fontSize: "12px" }}>
					{blockedReason}
				</div>
			)}
			{refusal && (
				<div
					data-testid="auto-run-refusal"
					role="alert"
					style={{ marginTop: "4px", fontSize: "12px", color: "var(--vscode-errorForeground)" }}>
					{refusal}
				</div>
			)}
			{tool.description && (
				<div
					style={{
						marginLeft: "0px",
						marginTop: "4px",
						opacity: 0.8,
						fontSize: "12px",
						...(compact && {
							display: "-webkit-box",
							WebkitLineClamp: 1,
							WebkitBoxOrient: "vertical" as const,
							overflow: "hidden",
						}),
					}}>
					{tool.description}
				</div>
			)}
			{!compact &&
				tool.inputSchema &&
				"properties" in tool.inputSchema &&
				Object.keys(tool.inputSchema.properties as Record<string, any>).length > 0 && (
					<div
						style={{
							marginTop: "8px",
							fontSize: "12px",
							border: "1px solid color-mix(in srgb, var(--vscode-descriptionForeground) 30%, transparent)",
							borderRadius: "3px",
							padding: "8px",
						}}>
						<div
							style={{
								marginBottom: "4px",
								opacity: 0.8,
								fontSize: "11px",
								textTransform: "uppercase",
							}}>
							Parameters
						</div>
						{Object.entries(tool.inputSchema.properties as Record<string, any>).map(([paramName, schema]) => {
							const isRequired =
								tool.inputSchema &&
								"required" in tool.inputSchema &&
								Array.isArray(tool.inputSchema.required) &&
								tool.inputSchema.required.includes(paramName)

							return (
								<div
									key={paramName}
									style={{
										display: "flex",
										alignItems: "baseline",
										marginTop: "4px",
									}}>
									<code
										style={{
											color: "var(--vscode-textPreformat-foreground)",
											marginRight: "8px",
										}}>
										{paramName}
										{isRequired && (
											<span
												style={{
													color: "var(--vscode-errorForeground)",
												}}>
												*
											</span>
										)}
									</code>
									<span
										style={{
											opacity: 0.8,
											overflowWrap: "break-word",
											wordBreak: "break-word",
										}}>
										{schema.description || "No description"}
									</span>
								</div>
							)
						})}
					</div>
				)}
		</div>
	)
}

export default McpToolRow
