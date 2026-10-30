import {
	alwaysAllowReasonText,
	bulkAutoRunState,
	describeAutoApproveRefusal,
	parseAutoApproveRefusal,
} from "@shared/aihydro/alwaysAllowPolicy"
import { DEFAULT_MCP_TIMEOUT_SECONDS, McpServer } from "@shared/mcp"
import { StringRequest } from "@shared/proto/cline/common"
import {
	McpServers,
	ToggleMcpServerRequest,
	ToggleToolAutoApproveRequest,
	UpdateMcpTimeoutRequest,
} from "@shared/proto/cline/mcp"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import {
	VSCodeButton,
	VSCodeCheckbox,
	VSCodeDropdown,
	VSCodeOption,
	VSCodePanels,
	VSCodePanelTab,
	VSCodePanelView,
} from "@vscode/webview-ui-toolkit/react"
import { type CSSProperties, useCallback, useId, useState } from "react"
import DangerButton from "@/components/common/DangerButton"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"
import { getMcpServerDisplayName } from "@/utils/mcp"
import McpResourceRow from "./McpResourceRow"
import McpToolRow from "./McpToolRow"

// constant JSX.Elements
const STATUS_LABEL: Record<McpServer["status"], string> = {
	connected: "Connected",
	connecting: "Connecting",
	disconnected: "Disconnected",
}

/** The name area: fills the row, left-aligned, a button when the row can expand. */
const nameStyle: CSSProperties = {
	flex: 1,
	minWidth: 0,
	display: "flex",
	alignItems: "center",
	gap: "8px",
	minHeight: "24px",
	padding: 0,
	marginRight: "4px",
	border: 0,
	background: "transparent",
	color: "inherit",
	font: "inherit",
	textAlign: "left",
}
/** A 28 x 24 hit area around a 24 x 12 track, so the switch meets the 24 px target size. */
const switchStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	width: "28px",
	height: "24px",
	marginLeft: "8px",
	padding: 0,
	border: 0,
	background: "transparent",
	cursor: "pointer",
	flexShrink: 0,
}
const switchTrack: CSSProperties = {
	position: "relative",
	width: "26px",
	height: "14px",
	boxSizing: "border-box",
	border: "1px solid",
	borderRadius: "7px",
	transition: "background-color 0.2s",
}
const switchKnob: CSSProperties = {
	position: "absolute",
	top: "2px",
	width: "8px",
	height: "8px",
	borderRadius: "50%",
	transition: "left 0.2s",
}

const TimeoutOptions = [
	{ value: "30", label: "30 seconds" },
	{ value: "60", label: "1 minute" },
	{ value: "300", label: "5 minutes" },
	{ value: "600", label: "10 minutes" },
	{ value: "1800", label: "30 minutes" },
	{ value: "3600", label: "1 hour" },
].map((option) => (
	<VSCodeOption key={option.value} value={option.value}>
		{option.label}
	</VSCodeOption>
))

const ServerRow = ({
	server,
	isExpandable = true,
	hasTrashIcon = true,
}: {
	server: McpServer
	isExpandable?: boolean
	hasTrashIcon?: boolean
}) => {
	const { mcpMarketplaceCatalog, autoApprovalSettings, setMcpServers } = useExtensionState()

	const [isExpanded, setIsExpanded] = useState(false)
	const [isDeleting, setIsDeleting] = useState(false)
	const [isRestarting, setIsRestarting] = useState(false)

	const getStatusColor = useCallback((status: McpServer["status"]) => {
		switch (status) {
			case "connected":
				return "var(--vscode-testing-iconPassed)"
			case "connecting":
				return "var(--vscode-charts-yellow)"
			case "disconnected":
				return "var(--vscode-testing-iconFailed)"
		}
	}, [])

	const detailsId = useId()
	const displayName = getMcpServerDisplayName(server.name, mcpMarketplaceCatalog)

	const handleRowClick = () => {
		if (!server.error && isExpandable) {
			setIsExpanded(!isExpanded)
		}
	}

	const [timeoutValue, setTimeoutValue] = useState<string>(() => {
		try {
			const config = JSON.parse(server.config)
			return config.timeout?.toString() || DEFAULT_MCP_TIMEOUT_SECONDS.toString()
		} catch {
			return DEFAULT_MCP_TIMEOUT_SECONDS.toString()
		}
	})

	const handleTimeoutChange = (e: any) => {
		const select = e.target as HTMLSelectElement
		const value = select.value
		const num = parseInt(value)
		setTimeoutValue(value)

		McpServiceClient.updateMcpTimeout({
			serverName: server.name,
			timeout: num,
		} as UpdateMcpTimeoutRequest)
			.then((response: McpServers) => {
				const mcpServers = convertProtoMcpServersToMcpServers(response.mcpServers)
				setMcpServers(mcpServers)
			})
			.catch((error) => {
				console.error("Error updating MCP server timeout", error)
			})
	}

	const handleRestart = () => {
		// Set local state to show "connecting" status
		setIsRestarting(true)

		// Make the gRPC call
		McpServiceClient.restartMcpServer({
			value: server.name,
		} as StringRequest)
			.then((response: McpServers) => {
				// Update with the final state from the server
				const mcpServers = convertProtoMcpServersToMcpServers(response.mcpServers)
				setMcpServers(mcpServers)
				setIsRestarting(false)
			})
			.catch((error) => {
				// Reset the restarting state
				setIsRestarting(false)
				console.error("Error restarting MCP server", error)
			})
	}

	const handleDelete = () => {
		setIsDeleting(true)
		McpServiceClient.deleteMcpServer({
			value: server.name,
		} as StringRequest)
			.then((response: McpServers) => {
				const mcpServers = convertProtoMcpServersToMcpServers(response.mcpServers)
				setMcpServers(mcpServers)
				setIsDeleting(false)
			})
			.catch((error) => {
				console.error("Error deleting MCP server", error)
				setIsDeleting(false)
			})
	}

	const [autoRunNotice, setAutoRunNotice] = useState<string | undefined>()

	// What the bulk control shows and sends. The host re-checks every add; this only avoids sending a request it
	// would refuse, and never blocks a revoke.
	const bulk = bulkAutoRunState({
		serverTrusted: server.trust?.trusted === true,
		serverConnected: server.status === "connected",
		tools: server.tools,
	})
	const allBlockedReason = bulk.disabled
		? alwaysAllowReasonText(
				server.trust?.trusted !== true
					? "untrusted_server"
					: server.status !== "connected"
						? "server_unavailable"
						: "unknown_effect",
			)
		: undefined

	const handleAutoApproveChange = () => {
		if (!server.name || bulk.disabled) {
			return
		}
		setAutoRunNotice(undefined)

		McpServiceClient.toggleToolAutoApprove(
			ToggleToolAutoApproveRequest.create({
				serverName: server.name,
				toolNames: bulk.toolNames,
				autoApprove: bulk.enabling,
			}),
		)
			.then((response) => {
				const mcpServers = convertProtoMcpServersToMcpServers(response.mcpServers)
				setMcpServers(mcpServers)
			})
			.catch((error) => {
				const parsed = parseAutoApproveRefusal(error instanceof Error ? error.message : String(error))
				if (parsed) {
					setAutoRunNotice(describeAutoApproveRefusal(parsed))
				} else {
					console.error("Error toggling all tools auto-approve", error)
					setAutoRunNotice("Could not update auto-run. Nothing was changed.")
				}
			})
	}

	const handleToggleMcpServer = () => {
		McpServiceClient.toggleMcpServer(
			ToggleMcpServerRequest.create({
				serverName: server.name,
				disabled: !server.disabled,
			}),
		)
			.then((response) => {
				const mcpServers = convertProtoMcpServersToMcpServers(response.mcpServers)
				setMcpServers(mcpServers)
			})
			.catch((error) => {
				console.error("Error toggling MCP server", error)
			})
	}

	return (
		<div style={{ marginBottom: "10px" }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					padding: "8px",
					background: "var(--vscode-textCodeBlock-background)",
					borderRadius: isExpanded || server.error || server.trust ? "4px 4px 0 0" : "4px",
					opacity: server.disabled ? 0.6 : 1,
				}}>
				{/* The name is the control that opens the row: a real button, so the keyboard can expand it. */}
				{!server.error && isExpandable ? (
					<button
						aria-controls={isExpanded ? detailsId : undefined}
						aria-expanded={isExpanded}
						onClick={handleRowClick}
						style={{ ...nameStyle, cursor: "pointer" }}
						type="button">
						<span aria-hidden="true" className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`} />
						<span style={{ wordBreak: "break-all" }}>{displayName}</span>
					</button>
				) : (
					<span style={nameStyle}>
						<span style={{ wordBreak: "break-all" }}>{displayName}</span>
					</span>
				)}
				{/* Collapsed view controls */}
				{!server.error && (
					<div style={{ display: "flex", alignItems: "center", gap: "4px", marginLeft: "8px" }}>
						<VSCodeButton
							appearance="icon"
							aria-label={`Restart ${displayName}`}
							disabled={server.status === "connecting" || isRestarting}
							onClick={(e) => {
								e.stopPropagation()
								handleRestart()
							}}
							title="Restart Server">
							<span className="codicon codicon-sync"></span>
						</VSCodeButton>
						{hasTrashIcon && (
							<VSCodeButton
								appearance="icon"
								aria-label={`Delete ${displayName}`}
								disabled={isDeleting}
								onClick={(e) => {
									e.stopPropagation()
									handleDelete()
								}}
								title="Delete Server">
								<span className="codicon codicon-trash"></span>
							</VSCodeButton>
						)}
					</div>
				)}
				{/* Enable switch: a 24 px target with a name, neutral colours (green means approved claims elsewhere). */}
				<button
					aria-checked={!server.disabled}
					aria-label={`Enable ${displayName}`}
					onClick={handleToggleMcpServer}
					role="switch"
					style={switchStyle}
					title={server.disabled ? `Enable ${displayName}` : `Disable ${displayName}`}
					type="button">
					<span
						aria-hidden="true"
						style={{
							...switchTrack,
							background: server.disabled ? "var(--vscode-input-background)" : "var(--vscode-button-background)",
							borderColor: server.disabled
								? "var(--vscode-checkbox-border, currentColor)"
								: "var(--vscode-button-background)",
						}}>
						<span
							style={{
								...switchKnob,
								left: server.disabled ? "2px" : "14px",
								background: server.disabled
									? "var(--vscode-foreground)"
									: "var(--vscode-button-foreground, #fff)",
							}}
						/>
					</span>
				</button>
				<span
					aria-label={STATUS_LABEL[server.status]}
					role="img"
					style={{
						width: "8px",
						height: "8px",
						borderRadius: "50%",
						background: getStatusColor(server.status),
						marginLeft: "8px",
						flexShrink: 0,
					}}
					title={STATUS_LABEL[server.status]}
				/>
			</div>

			{server.trust && (
				<div
					data-testid="mcp-server-trust"
					style={{
						display: "flex",
						alignItems: "baseline",
						gap: "6px",
						padding: "0 8px 6px 8px",
						fontSize: "11px",
						background: "var(--vscode-textCodeBlock-background)",
						borderRadius: isExpanded || server.error ? "0" : "0 0 4px 4px",
						opacity: server.disabled ? 0.6 : 1,
					}}>
					{/* Neutral for trusted (trust is not a green "approved" state); warning colour when not trusted. */}
					<span
						style={{
							flexShrink: 0,
							fontWeight: 600,
							color: server.trust.trusted ? "var(--vscode-foreground)" : "var(--vscode-editorWarning-foreground)",
						}}>
						{server.trust.trusted ? "Trusted" : "Not trusted"}
					</span>
					<span style={{ opacity: 0.75, overflowWrap: "anywhere" }}>
						{server.trust.reason.replace(/^(Not trusted|Trusted):\s*/, "")}
					</span>
				</div>
			)}

			{server.error ? (
				<div
					style={{
						fontSize: "13px",
						background: "var(--vscode-textCodeBlock-background)",
						borderRadius: "0 0 4px 4px",
						width: "100%",
					}}>
					<div
						style={{
							color: "var(--vscode-testing-iconFailed)",
							marginBottom: "8px",
							padding: "0 10px",
							overflowWrap: "break-word",
							wordBreak: "break-word",
						}}>
						{server.error}
					</div>
					<VSCodeButton
						appearance="secondary"
						disabled={server.status === "connecting"}
						onClick={handleRestart}
						style={{
							width: "calc(100% - 20px)",
							margin: "0 10px 10px 10px",
						}}>
						{server.status === "connecting" || isRestarting ? "Retrying..." : "Retry Connection"}
					</VSCodeButton>

					<DangerButton
						disabled={isDeleting}
						onClick={handleDelete}
						style={{ width: "calc(100% - 20px)", margin: "0 10px 10px 10px" }}>
						{isDeleting ? "Deleting..." : "Delete Server"}
					</DangerButton>
				</div>
			) : (
				isExpanded && (
					<div
						id={detailsId}
						style={{
							background: "var(--vscode-textCodeBlock-background)",
							padding: "0 10px 10px 10px",
							fontSize: "13px",
							borderRadius: "0 0 4px 4px",
						}}>
						<VSCodePanels>
							<VSCodePanelTab id="tools">Tools ({server.tools?.length || 0})</VSCodePanelTab>
							<VSCodePanelTab id="resources">
								Resources ({[...(server.resourceTemplates || []), ...(server.resources || [])].length || 0})
							</VSCodePanelTab>

							<VSCodePanelView id="tools-view">
								{server.tools && server.tools.length > 0 ? (
									<div
										style={{
											display: "flex",
											flexDirection: "column",
											gap: "8px",
											width: "100%",
										}}>
										{server.tools.map((tool) => (
											<McpToolRow
												key={tool.name}
												serverConnected={server.status === "connected"}
												serverName={server.name}
												serverTools={server.tools}
												serverTrusted={server.trust?.trusted === true}
												tool={tool}
											/>
										))}
										{server.name && autoApprovalSettings.enabled && autoApprovalSettings.actions.useMcp && (
											<VSCodeCheckbox
												aria-describedby={
													allBlockedReason ? `auto-run-all-reason-${server.name}` : undefined
												}
												checked={bulk.checked}
												data-tool="all-tools"
												disabled={bulk.disabled}
												onChange={handleAutoApproveChange}
												style={{ marginBottom: -10 }}
												title={allBlockedReason}>
												Auto-run all tools
											</VSCodeCheckbox>
										)}
										{allBlockedReason && (
											<div
												data-testid="auto-run-all-blocked-reason"
												style={{ marginTop: "10px", opacity: 0.8, fontSize: "12px" }}>
												{allBlockedReason}
											</div>
										)}
										{autoRunNotice && (
											<div
												data-testid="auto-run-refusal"
												role="alert"
												style={{
													marginTop: "10px",
													fontSize: "12px",
													color: "var(--vscode-errorForeground)",
												}}>
												{autoRunNotice}
											</div>
										)}
									</div>
								) : (
									<div
										style={{
											padding: "10px 0",
											color: "var(--vscode-descriptionForeground)",
										}}>
										No tools found
									</div>
								)}
							</VSCodePanelView>

							<VSCodePanelView id="resources-view">
								{(server.resources && server.resources.length > 0) ||
								(server.resourceTemplates && server.resourceTemplates.length > 0) ? (
									<div
										style={{
											display: "flex",
											flexDirection: "column",
											gap: "8px",
											width: "100%",
										}}>
										{[...(server.resourceTemplates || []), ...(server.resources || [])].map((item) => (
											<McpResourceRow
												item={item}
												key={"uriTemplate" in item ? item.uriTemplate : item.uri}
											/>
										))}
									</div>
								) : (
									<div
										style={{
											padding: "10px 0",
											color: "var(--vscode-descriptionForeground)",
										}}>
										No resources found
									</div>
								)}
							</VSCodePanelView>
						</VSCodePanels>

						<div style={{ margin: "10px 7px" }}>
							<label style={{ display: "block", marginBottom: "4px", fontSize: "13px" }}>Request Timeout</label>
							<VSCodeDropdown onChange={handleTimeoutChange} style={{ width: "100%" }} value={timeoutValue}>
								{TimeoutOptions}
							</VSCodeDropdown>
						</div>
						<VSCodeButton
							appearance="secondary"
							disabled={server.status === "connecting" || isRestarting}
							onClick={handleRestart}
							style={{
								width: "calc(100% - 14px)",
								margin: "0 7px 3px 7px",
							}}>
							{server.status === "connecting" || isRestarting ? "Restarting..." : "Restart Server"}
						</VSCodeButton>

						<DangerButton
							disabled={isDeleting}
							onClick={handleDelete}
							style={{ width: "calc(100% - 14px)", margin: "5px 7px 3px 7px" }}>
							{isDeleting ? "Deleting..." : "Delete Server"}
						</DangerButton>
					</div>
				)
			)}
		</div>
	)
}

export default ServerRow
