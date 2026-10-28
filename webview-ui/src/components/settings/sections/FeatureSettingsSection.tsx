import { McpDisplayMode } from "@shared/McpDisplayMode"
import { OpenaiReasoningEffort } from "@shared/storage/types"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"
import HeroTooltip from "@/components/common/HeroTooltip"
import McpDisplayModeDropdown from "@/components/mcp/chat-display/McpDisplayModeDropdown"
import { useExtensionState } from "@/context/ExtensionStateContext"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface FeatureSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const FeatureSettingsSection = ({ renderSectionHeader }: FeatureSettingsSectionProps) => {
	const {
		enableCheckpointsSetting,
		mcpMarketplaceEnabled,
		mcpDisplayMode,
		mcpResponsesCollapsed,
		openaiReasoningEffort,
		strictPlanModeEnabled,
		finalAnswerAuditEnabled,
		finalAnswerAuditGate,
		yoloModeToggled,
		useAutoCondense,
		focusChainSettings,
		maxConsecutiveMistakes,
		multiRootSetting,
		hooksEnabled,
		remoteConfigSettings,
	} = useExtensionState()

	const handleReasoningEffortChange = (newValue: OpenaiReasoningEffort) => {
		updateSetting("openaiReasoningEffort", newValue)
	}

	return (
		<div>
			{renderSectionHeader("features")}
			<Section>
				<div className="mb-5">
					<div className="settings-card">
						<div className="settings-section-header">
							<span className="codicon codicon-checklist" />
							Core Features
						</div>
						<div className="settings-toggle-row">
							<VSCodeCheckbox
								checked={enableCheckpointsSetting}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("enableCheckpointsSetting", checked)
								}}>
								Enable Checkpoints
							</VSCodeCheckbox>
						</div>
						<p className="toggle-description">
							Enables extension to save checkpoints of workspace throughout the task. Uses git under the hood which
							may not work well with large workspaces.
						</p>
					</div>
					<div className="settings-card">
						<div className="settings-section-header">
							<span className="codicon codicon-extensions" />
							MCP & Marketplace
						</div>
						{remoteConfigSettings?.mcpMarketplaceEnabled !== undefined ? (
							<HeroTooltip content="This setting is managed by your organization's remote configuration">
								<div className="flex items-center gap-2">
									<VSCodeCheckbox
										checked={mcpMarketplaceEnabled}
										disabled={true}
										onChange={(e: any) => {
											const checked = e.target.checked === true
											updateSetting("mcpMarketplaceEnabled", checked)
										}}>
										Enable MCP Marketplace
									</VSCodeCheckbox>
									<i className="codicon codicon-lock text-[var(--vscode-descriptionForeground)] text-sm" />
								</div>
							</HeroTooltip>
						) : (
							<VSCodeCheckbox
								checked={mcpMarketplaceEnabled}
								disabled={false}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("mcpMarketplaceEnabled", checked)
								}}>
								Enable MCP Marketplace
							</VSCodeCheckbox>
						)}
						<p className="toggle-description">
							Enables the MCP Marketplace tab for discovering and installing MCP servers.
						</p>
						<div className="mt-2">
							<label className="settings-label" htmlFor="mcp-display-mode-dropdown">
								MCP Display Mode
							</label>
							<McpDisplayModeDropdown
								className="w-full"
								id="mcp-display-mode-dropdown"
								onChange={(newMode: McpDisplayMode) => updateSetting("mcpDisplayMode", newMode)}
								value={mcpDisplayMode}
							/>
							<p className="toggle-description">
								Controls how MCP responses are displayed: plain text, rich formatting with links/images, or
								markdown rendering.
							</p>
						</div>
						<div className="mt-2">
							<VSCodeCheckbox
								checked={mcpResponsesCollapsed}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("mcpResponsesCollapsed", checked)
								}}>
								Collapse MCP Responses
							</VSCodeCheckbox>
							<p className="toggle-description">Sets the default display mode for MCP response panels</p>
						</div>
					</div>

					<div className="settings-card">
						<div className="settings-section-header">
							<span className="codicon codicon-brain" />
							AI Reasoning & Planning
						</div>
						<div className="mb-2">
							<label className="settings-label" htmlFor="openai-reasoning-effort-dropdown">
								OpenAI Reasoning Effort
							</label>
							<VSCodeDropdown
								className="w-full"
								currentValue={openaiReasoningEffort || "medium"}
								id="openai-reasoning-effort-dropdown"
								onChange={(e: any) => {
									const newValue = e.target.currentValue as OpenaiReasoningEffort
									handleReasoningEffortChange(newValue)
								}}>
								<VSCodeOption value="minimal">Minimal</VSCodeOption>
								<VSCodeOption value="low">Low</VSCodeOption>
								<VSCodeOption value="medium">Medium</VSCodeOption>
								<VSCodeOption value="high">High</VSCodeOption>
							</VSCodeDropdown>
							<p className="toggle-description">
								Reasoning effort for the OpenAI family of models (applies to all OpenAI model providers)
							</p>
						</div>
						<div className="mt-2">
							<VSCodeCheckbox
								checked={strictPlanModeEnabled}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("strictPlanModeEnabled", checked)
								}}>
								Enable strict plan mode
							</VSCodeCheckbox>
							<p className="toggle-description">
								Enforces strict tool use while in plan mode, preventing file edits.
							</p>
						</div>
						<div className="mt-2">
							<VSCodeCheckbox
								checked={finalAnswerAuditEnabled !== false}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("finalAnswerAuditEnabled", checked)
								}}>
								Audit final answers
							</VSCodeCheckbox>
							<p className="toggle-description">
								When the AI-Hydro MCP server is connected, checks each final answer for uncited numbers and
								unsupported claims and shows the result below the answer. With the check below on (the default),
								an answer with uncited numbers can cost up to 2 extra model requests while the agent revises it.
							</p>
						</div>
						<div className="mt-2">
							<VSCodeCheckbox
								checked={finalAnswerAuditGate === true}
								disabled={finalAnswerAuditEnabled === false}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("finalAnswerAuditGate", checked)
								}}>
								Check answers before showing them
							</VSCodeCheckbox>
							<p className="toggle-description">
								On by default. Requires answer auditing and a connected AI-Hydro server with the graded audit;
								with any other server nothing changes. When the audit finds uncited quantities (hard findings),
								the answer is held back and the agent is asked to revise it, up to 2 times, before you see it.
								Each revision costs one extra model request and delays the answer. If findings remain, the answer
								is shown with that stated. It checks that numbers are traced to recorded runs; it does not check
								that the science is correct.
							</p>
						</div>
						<div className="mt-2">
							<label className="settings-label" htmlFor="max-consecutive-mistakes">
								Max consecutive mistakes
							</label>
							<VSCodeTextField
								className="w-20"
								id="max-consecutive-mistakes"
								onChange={(e: any) => {
									const value = parseInt(e.target.value, 10)
									if (!Number.isNaN(value) && value >= 1 && value <= 20) {
										updateSetting("maxConsecutiveMistakes", value)
									}
								}}
								value={String(maxConsecutiveMistakes ?? 3)}
							/>
							<p className="toggle-description">
								Number of consecutive tool-call failures before the agent asks for help or auto-recovers (1–20).
								Increase for weaker models; decrease for stricter oversight.
							</p>
						</div>
						{
							<div className="mt-2">
								<VSCodeCheckbox
									checked={focusChainSettings?.enabled || false}
									onChange={(e: any) => {
										const checked = e.target.checked === true
										updateSetting("focusChainSettings", { ...focusChainSettings, enabled: checked })
									}}>
									Enable Focus Chain
								</VSCodeCheckbox>
								<p className="toggle-description">
									Enables enhanced task progress tracking and automatic focus chain list management throughout
									tasks.
								</p>
							</div>
						}
						{focusChainSettings?.enabled && (
							<div className="mt-2 ml-5">
								<label className="settings-label" htmlFor="focus-chain-remind-interval">
									Focus Chain Reminder Interval
								</label>
								<VSCodeTextField
									className="w-20"
									id="focus-chain-remind-interval"
									onChange={(e: any) => {
										const value = parseInt(e.target.value, 10)
										if (!Number.isNaN(value) && value >= 1 && value <= 100) {
											updateSetting("focusChainSettings", {
												...focusChainSettings,
												remindAiHydroInterval: value,
											})
										}
									}}
									value={String(focusChainSettings?.remindAiHydroInterval || 6)}
								/>
								<p className="toggle-description">
									Interval (in messages) to remind AI-Hydro about its focus chain checklist (1-100). Lower
									values provide more frequent reminders.
								</p>
							</div>
						)}
					</div>

					<div className="settings-card">
						<div className="settings-section-header">
							<span className="codicon codicon-compress" />
							Context Management
						</div>
						<div className="settings-toggle-row">
							<VSCodeCheckbox
								checked={useAutoCondense}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("useAutoCondense", checked)
								}}>
								Enable Auto Compact
							</VSCodeCheckbox>
						</div>
						<p className="toggle-description">
							Enables advanced context management system which uses LLM based condensing for next-gen models.{" "}
							<a
								className="text-[var(--vscode-textLink-foreground)] hover:text-[var(--vscode-textLink-activeForeground)]"
								href="https://github.com/AI-Hydro/AI-Hydro#readme"
								rel="noopener noreferrer"
								target="_blank">
								Learn more
							</a>
						</p>
						{multiRootSetting.featureFlag && (
							<div className="mt-2">
								<VSCodeCheckbox
									checked={multiRootSetting.user}
									onChange={(e: any) => {
										const checked = e.target.checked === true
										updateSetting("multiRootEnabled", checked)
									}}>
									Enable Multi-Root Workspace
								</VSCodeCheckbox>
								<p className="toggle-description">
									<span className="text-[var(--vscode-errorForeground)]">Experimental: </span>
									Allows AI-Hydro to work across multiple workspaces.
								</p>
							</div>
						)}
						{hooksEnabled?.featureFlag && (
							<div className="mt-2">
								<VSCodeCheckbox
									checked={hooksEnabled.user}
									onChange={(e: any) => {
										const checked = e.target.checked === true
										updateSetting("hooksEnabled", checked)
									}}>
									Enable Hooks
								</VSCodeCheckbox>
								<p className="toggle-description">
									<span className="text-[var(--vscode-errorForeground)]">Experimental: </span>
									Allows execution of hooks from .aihydrorules/hooks/ directory.
								</p>
							</div>
						)}
					</div>

					<div className="settings-card">
						<div className="settings-section-header">
							<span className="codicon codicon-warning" />
							Advanced / Dangerous
						</div>
						{remoteConfigSettings?.yoloModeToggled !== undefined ? (
							<HeroTooltip content="This setting is managed by your organization's remote configuration">
								<div className="flex items-center gap-2">
									<VSCodeCheckbox
										checked={yoloModeToggled}
										disabled={true}
										onChange={(e: any) => {
											const checked = e.target.checked === true
											updateSetting("yoloModeToggled", checked)
										}}>
										Enable YOLO Mode
									</VSCodeCheckbox>
									<i className="codicon codicon-lock text-[var(--vscode-descriptionForeground)] text-sm" />
								</div>
							</HeroTooltip>
						) : (
							<VSCodeCheckbox
								checked={yoloModeToggled}
								disabled={false}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("yoloModeToggled", checked)
								}}>
								Enable YOLO Mode
							</VSCodeCheckbox>
						)}
						<p className="toggle-description text-[var(--vscode-errorForeground)]">
							EXPERIMENTAL & DANGEROUS: This mode disables safety checks and user confirmations. AI-Hydro will
							automatically approve all actions without asking. Use with extreme caution.
						</p>
					</div>
				</div>
			</Section>
		</div>
	)
}

export default memo(FeatureSettingsSection)
