interface Props {
	status: "loading" | "connected" | "stale"
	error?: string
	onReconnect: () => void
}

export function MapConnectionStatus({ status: connectionStatus, error: connectionError, onReconnect: reconnect }: Props) {
	if (connectionStatus === "connected") return null
	return (
		<div
			role={connectionStatus === "stale" ? "alert" : "status"}
			style={{
				position: "absolute",
				top: 12,
				left: "25%",
				right: "25%",
				zIndex: 50,
				padding: 10,
				background: "var(--vscode-editor-background)",
				color: "var(--vscode-foreground)",
				border: "1px solid var(--vscode-editorWarning-foreground)",
				borderRadius: 4,
			}}>
			{connectionStatus === "loading"
				? "Synchronizing map… Existing layers may be out of date."
				: `Map updates interrupted. Displayed layers may be out of date. ${connectionError ?? ""}`}
			{connectionStatus === "stale" && (
				<button onClick={reconnect} style={{ marginLeft: 8 }}>
					Reconnect
				</button>
			)}
		</div>
	)
}
