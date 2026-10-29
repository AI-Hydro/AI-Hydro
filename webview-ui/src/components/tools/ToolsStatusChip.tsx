import { describeToolsStatus, TOOLS_ACTION_LABEL, type ToolsEnvAction } from "@shared/aihydro/toolsEnv"
import { ToolsEnvActionRequest } from "@shared/proto/cline/mcp"
import { Button, Text } from "@/design"
import { McpServiceClient } from "@/services/grpc-client"
import { type ToolsEnvView, useToolsEnvStatus } from "./useToolsEnvStatus"
import "./tools-status.css"

const ICON: Record<string, string> = { ok: "check", busy: "sync", warn: "warning", error: "error" }

export function runToolsAction(action: ToolsEnvAction): void {
	McpServiceClient.runToolsEnvAction(ToolsEnvActionRequest.create({ action })).catch((error) =>
		console.error(`Tools action ${action} failed:`, error),
	)
}

/** One status row: version, healthy or not, trusted or not, and the actions that fit. Presentation only. */
export function ToolsStatusRow({ status }: { status: ToolsEnvView }) {
	const model = describeToolsStatus(status)
	return (
		<section aria-label="AI-Hydro tools status" className={`tools-chip tools-chip--${model.tone}`} data-testid="tools-status">
			<div className="tools-chip__line">
				<span aria-hidden="true" className={`codicon codicon-${ICON[model.tone]}`} />
				<Text as="span" variant="label">
					{model.label}
				</Text>
			</div>
			{model.detail && (
				<Text as="p" muted variant="label">
					{model.detail}
				</Text>
			)}
			{model.actions.length > 0 && (
				<div className="tools-chip__actions">
					{model.actions.map((action) => (
						<Button
							key={action}
							onClick={() => runToolsAction(action)}
							variant={action === model.actions[0] ? "primary" : "ghost"}>
							{TOOLS_ACTION_LABEL[action]}
						</Button>
					))}
				</div>
			)}
		</section>
	)
}

/** The status chip for Welcome and the chat-home sidebar. Renders nothing until the host reports. */
export default function ToolsStatusChip() {
	const status = useToolsEnvStatus()
	return status ? <ToolsStatusRow status={status} /> : null
}
