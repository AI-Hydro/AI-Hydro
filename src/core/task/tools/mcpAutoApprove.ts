/**
 * Whether the host's own view of an MCP tool carries an auto-approve grant. The ONE place the use_mcp_tool handler
 * reads it, so a test can assert the real decision against settings the host actually wrote. The flag is set from
 * the policy-accepted settings only (McpHub.markAutoApprove), never from the model or the webview.
 */
interface ConnectionsView {
	connections?: { server: { name: string; tools?: { name: string; autoApprove?: boolean }[] } }[]
}

export function isMcpToolGrantedAutoApprove(
	hub: ConnectionsView | undefined,
	serverName: string | undefined,
	toolName: string | undefined,
): boolean {
	return (
		hub?.connections?.find((conn) => conn.server.name === serverName)?.server.tools?.find((tool) => tool.name === toolName)
			?.autoApprove === true
	)
}
