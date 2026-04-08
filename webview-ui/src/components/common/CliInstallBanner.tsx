import { StringRequest } from "@shared/proto/cline/common"
import { EmptyRequest, Int64Request } from "@shared/proto/index.cline"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { Terminal } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient, UiServiceClient } from "@/services/grpc-client"
import { getAsVar, VSC_INACTIVE_SELECTION_BACKGROUND } from "@/utils/vscStyles"

export const CURRENT_CLI_BANNER_VERSION = 1

export const CliInstallBanner: React.FC = () => {
	const { navigateToSettings, subagentsEnabled, platform } = useExtensionState()
	const [isCopied, setIsCopied] = useState(false)
	const [isAiHydroCliInstalled, setIsAiHydroCliInstalled] = useState(false)

	const isMacOS = platform === "darwin"

	// Poll for CLI installation status while the component is mounted
	useEffect(() => {
		const checkInstallation = async () => {
			try {
				const result = await StateServiceClient.checkCliInstallation(EmptyRequest.create())
				setIsAiHydroCliInstalled(result.value)
			} catch (error) {
				console.error("Failed to check CLI installation:", error)
			}
		}

		// Check immediately when component mounts
		checkInstallation()

		// Set up polling interval (every 1.5 seconds)
		const pollInterval = setInterval(checkInstallation, 1500)

		// Clean up interval when component unmounts
		return () => {
			clearInterval(pollInterval)
		}
	}, [])

	const handleClose = useCallback((e?: React.MouseEvent) => {
		e?.preventDefault()
		e?.stopPropagation()

		// Update state to hide banner
		StateServiceClient.updateCliBannerVersion(Int64Request.create({ value: CURRENT_CLI_BANNER_VERSION })).catch(console.error)
	}, [])

	const handleInstallClick = async () => {
		if (!isAiHydroCliInstalled) {
			try {
				// Call the backend to initiate CLI installation
				await StateServiceClient.installAiHydroCli(EmptyRequest.create())
				// Banner will automatically close after successful installation
				// setTimeout(() => {
				// 	handleClose()
				// }, 500)
			} catch (error) {
				console.error("Failed to initiate CLI installation:", error)
			}
		}
	}

	const handleEnableSubagents = async () => {
		if (!subagentsEnabled) {
			// Navigate to settings and enable subagents
			navigateToSettings()
			// Scroll to features section after a brief delay to ensure settings is rendered
			setTimeout(async () => {
				try {
					await UiServiceClient.scrollToSettings(StringRequest.create({ value: "features" }))
				} catch (error) {
					console.error("Error scrolling to features settings:", error)
				}
			}, 300)
		}
	}

	const handleCopyCommand = async (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()

		// Copy the install command to clipboard
		await navigator.clipboard.writeText("npm install -g aihydro")

		// Show feedback by changing the icon
		setIsCopied(true)
		setTimeout(() => {
			setIsCopied(false)
		}, 1500)
	}

	return (
		<div
			className="flex flex-col gap-1 shrink-0 mb-1 relative text-sm mt-1.5 mx-4 no-underline transition-colors border-0 text-left"
			style={{
				backgroundColor: getAsVar(VSC_INACTIVE_SELECTION_BACKGROUND),
				borderRadius: "3px",
				color: "var(--vscode-foreground)",
				padding: "12px",
			}}>
			<h4 className="m-0 flex items-center gap-2" style={{ paddingRight: "24px" }}>
				<Terminal className="w-4 h-4" />
				{isMacOS ? "AI-Hydro CLI is here!" : "AI-Hydro CLI Information"}
			</h4>
			<p className="m-0">
				{isMacOS ? (
					<>
						Install to use AI-Hydro directly in your terminal and enable subagent capabilities. AI-Hydro can spawn{" "}
						<code>aihydro</code> commands to handle focused tasks like exploring large codebases for information. This
						keeps your main context window clean by running these operations in separate subprocesses.{" "}
						<a
							href="https://github.com/AI-Hydro/AI-Hydro#readme"
							rel="noopener noreferrer"
							style={{ color: "var(--vscode-textLink-foreground)" }}
							target="_blank">
							Learn more
						</a>
					</>
				) : (
					<>
						AI-Hydro CLI is available for Mac OS users now! coming <code>soon</code> to other platforms.{" "}
						<a
							href="https://github.com/AI-Hydro/AI-Hydro#readme"
							rel="noopener noreferrer"
							style={{ color: "var(--vscode-textLink-foreground)" }}
							target="_blank">
							Learn more
						</a>
					</>
				)}
			</p>
			<div className="flex flex-col gap-2 my-1">
				<div
					className="p-2 rounded flex items-center justify-between"
					style={{
						backgroundColor: "var(--vscode-editor-background)",
						fontFamily: "var(--vscode-editor-font-family)",
						fontSize: 12,
					}}>
					npm install -g aihydro
					<VSCodeButton
						appearance="icon"
						onClick={handleCopyCommand}
						style={{ marginLeft: "8px", flexShrink: 0 }}
						title={isCopied ? "Copied!" : "Copy command"}>
						<span className={`codicon ${isCopied ? "codicon-check" : "codicon-copy"}`}></span>
					</VSCodeButton>
				</div>
				{isMacOS ? (
					<div className="flex gap-2">
						<VSCodeButton
							appearance="primary"
							className="flex-1"
							disabled={isAiHydroCliInstalled}
							onClick={handleInstallClick}>
							{isAiHydroCliInstalled ? (
								<>
									<span className="codicon codicon-check" style={{ marginRight: "4px" }}></span>
									Installed
								</>
							) : (
								"Install"
							)}
						</VSCodeButton>
						<VSCodeButton
							appearance="primary"
							className="flex-1"
							disabled={subagentsEnabled}
							onClick={handleEnableSubagents}
							title="Configure Subagents">
							Enable Subagents
						</VSCodeButton>
					</div>
				) : (
					<div className="flex gap-2">
						<VSCodeButton
							appearance="primary"
							className="flex-1"
							disabled={isAiHydroCliInstalled}
							onClick={handleInstallClick}>
							{isAiHydroCliInstalled ? (
								<>
									<span className="codicon codicon-check" style={{ marginRight: "4px" }}></span>
									Installed
								</>
							) : (
								"Install CLI"
							)}
						</VSCodeButton>
						<VSCodeButton
							appearance="secondary"
							className="flex-1"
							disabled
							title="AI-Hydro CLI & subagents are only available on macOS">
							Subagents (macOS only)
						</VSCodeButton>
					</div>
				)}
			</div>

			{/* Close button */}
			<VSCodeButton
				appearance="icon"
				data-testid="cli-banner-close-button"
				onClick={handleClose}
				style={{ position: "absolute", top: "8px", right: "8px" }}>
				<span className="codicon codicon-close"></span>
			</VSCodeButton>
		</div>
	)
}

export default CliInstallBanner
