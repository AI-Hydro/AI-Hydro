import { VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import HeroTooltip from "@/components/common/HeroTooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import PreferredLanguageSetting from "../PreferredLanguageSetting"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface GeneralSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const GeneralSettingsSection = ({ renderSectionHeader }: GeneralSettingsSectionProps) => {
	const { telemetrySetting, remoteConfigSettings } = useExtensionState()
	const isDisabledByRemoteConfig = remoteConfigSettings?.telemetrySetting !== undefined

	return (
		<div>
			{renderSectionHeader("general")}
			<Section>
				<PreferredLanguageSetting />

				<div className="settings-card">
					<div className="settings-section-header">
						<span className="codicon codicon-graph" />
						Privacy & Telemetry
					</div>
					{isDisabledByRemoteConfig ? (
						<HeroTooltip content="This setting is managed by your organization's remote configuration">
							<div className="flex items-center gap-2 mb-2">
								<VSCodeCheckbox
									checked={remoteConfigSettings?.telemetrySetting === "enabled"}
									disabled={true}
									onChange={(e: any) => {
										const checked = e.target.checked === true
										updateSetting("telemetrySetting", checked ? "enabled" : "disabled")
									}}>
									Allow error and usage reporting
								</VSCodeCheckbox>
								<i className="codicon codicon-lock text-[var(--vscode-descriptionForeground)] text-sm" />
							</div>
						</HeroTooltip>
					) : (
						<VSCodeCheckbox
							checked={telemetrySetting === "enabled"}
							className="mb-1"
							disabled={false}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("telemetrySetting", checked ? "enabled" : "disabled")
							}}>
							Allow error and usage reporting
						</VSCodeCheckbox>
					)}
					<p className="toggle-description">
						Help improve AI-Hydro by sending anonymous usage data and error reports. Prompts, file contents and API
						keys are not part of what is sent. See what is collected, and what stays on your machine, in the{" "}
						<VSCodeLink
							className="text-inherit"
							href="https://github.com/AI-Hydro/AI-Hydro/blob/main/PRIVACY.md"
							style={{ fontSize: "inherit", textDecoration: "underline" }}>
							privacy and telemetry notes
						</VSCodeLink>
						.
					</p>
				</div>
			</Section>
		</div>
	)
}

export default GeneralSettingsSection
