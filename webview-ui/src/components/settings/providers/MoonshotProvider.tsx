import { moonshotModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { DropdownContainer, ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useDynamicProviderModels } from "../utils/useDynamicProviderModels"

/**
 * Props for the MoonshotProvider component
 */
interface MoonshotProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Moonshot AI Studio provider configuration component
 */
export const MoonshotProvider = ({ showModelOptions, isPopup, currentMode }: MoonshotProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)
	const moonshotBaseUrl =
		apiConfiguration?.moonshotApiLine === "china" ? "https://api.moonshot.cn/v1" : "https://api.moonshot.ai/v1"
	const {
		models: dynamicMoonshotModels,
		refresh: refreshMoonshotModels,
		isLoading: isLoadingMoonshotModels,
	} = useDynamicProviderModels({
		baseUrl: moonshotBaseUrl,
		apiKey: apiConfiguration?.moonshotApiKey,
		fallbackModels: moonshotModels,
		selectedModelId,
		selectedModelInfo,
		enabled: showModelOptions,
	})

	return (
		<div>
			<DropdownContainer className="dropdown-container" style={{ position: "inherit" }}>
				<label htmlFor="moonshot-entrypoint">
					<span style={{ fontWeight: 500, marginTop: 5 }}>Moonshot Entrypoint</span>
				</label>
				<VSCodeDropdown
					id="moonshot-entrypoint"
					onChange={(e) => handleFieldChange("moonshotApiLine", (e.target as any).value)}
					style={{
						minWidth: 130,
						position: "relative",
					}}
					value={apiConfiguration?.moonshotApiLine || "international"}>
					<VSCodeOption value="international">api.moonshot.ai</VSCodeOption>
					<VSCodeOption value="china">api.moonshot.cn</VSCodeOption>
				</VSCodeDropdown>
			</DropdownContainer>
			<ApiKeyField
				helpText="This key is stored locally and only used to make API requests from this extension."
				initialValue={apiConfiguration?.moonshotApiKey || ""}
				onChange={(value) => handleFieldChange("moonshotApiKey", value)}
				providerName="Moonshot"
				signupUrl={
					apiConfiguration?.moonshotApiLine === "china"
						? "https://platform.moonshot.cn/console/api-keys"
						: "https://platform.moonshot.ai/console/api-keys"
				}
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={dynamicMoonshotModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>
					<VSCodeButton disabled={isLoadingMoonshotModels} onClick={() => refreshMoonshotModels()}>
						{isLoadingMoonshotModels ? "Refreshing..." : "Refresh Moonshot models"}
					</VSCodeButton>

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
