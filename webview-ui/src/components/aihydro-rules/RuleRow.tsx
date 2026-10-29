import { StringRequest } from "@shared/proto/cline/common"
import { RuleFileRequest } from "@shared/proto/index.cline"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { FileServiceClient } from "@/services/grpc-client"

const RuleRow: React.FC<{
	rulePath: string
	enabled: boolean
	isGlobal: boolean
	ruleType: string
	toggleRule: (rulePath: string, enabled: boolean) => void
}> = ({ rulePath, enabled, isGlobal, toggleRule, ruleType }) => {
	// Check if the path type is Windows
	const win32Path = /^[a-zA-Z]:\\/.test(rulePath)
	// Get the filename from the path for display
	const displayName = rulePath.split(win32Path ? "\\" : "/").pop() || rulePath

	const handleEditClick = () => {
		FileServiceClient.openFile(StringRequest.create({ value: rulePath })).catch((err) =>
			console.error("Failed to open file:", err),
		)
	}

	const handleDeleteClick = () => {
		FileServiceClient.deleteRuleFile(
			RuleFileRequest.create({
				rulePath,
				isGlobal,
				type: ruleType || "aihydro",
			}),
		).catch((err) => console.error("Failed to delete rule file:", err))
	}

	return (
		<div className="mb-2.5">
			<div
				className={`flex items-center p-2 rounded bg-[var(--vscode-textCodeBlock-background)] h-[18px] ${
					enabled ? "opacity-100" : "opacity-60"
				}`}>
				<span className="flex-1 overflow-hidden break-all whitespace-normal flex items-center mr-1" title={rulePath}>
					<span className="ph-no-capture">{displayName}</span>
				</span>

				{/* Toggle Switch */}
				<div className="flex items-center ml-2 space-x-2">
					<div
						aria-checked={enabled}
						className={`w-[20px] h-[10px] rounded-[5px] relative cursor-pointer transition-colors duration-200 ${
							enabled
								? "bg-[var(--vscode-testing-iconPassed)] opacity-90"
								: "bg-[var(--vscode-titleBar-inactiveForeground)] opacity-50"
						}`}
						onClick={() => toggleRule(rulePath, !enabled)}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault()
								toggleRule(rulePath, !enabled)
							}
						}}
						role="switch"
						tabIndex={0}>
						<div
							className={`w-[6px] h-[6px] bg-white border border-[#66666699] rounded-full absolute top-[1px] transition-all duration-200 ${
								enabled ? "left-[12px]" : "left-[2px]"
							}`}
						/>
					</div>
					<VSCodeButton
						appearance="icon"
						aria-label="Edit rule file"
						onClick={handleEditClick}
						style={{ height: "20px" }}
						title="Edit rule file">
						<span className="codicon codicon-edit" style={{ fontSize: "14px" }} />
					</VSCodeButton>
					<VSCodeButton
						appearance="icon"
						aria-label="Delete rule file"
						onClick={handleDeleteClick}
						style={{ height: "20px" }}
						title="Delete rule file">
						<span className="codicon codicon-trash" style={{ fontSize: "14px" }} />
					</VSCodeButton>
				</div>
			</div>
		</div>
	)
}

export default RuleRow
