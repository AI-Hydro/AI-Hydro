import { openAiNativeModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useDynamicProviderModels } from "../utils/useDynamicProviderModels"

/**
 * Props for the OpenAINativeProvider component
 */
interface OpenAINativeProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The OpenAI (native) provider configuration component
 */
export const OpenAINativeProvider = ({ showModelOptions, isPopup, currentMode }: OpenAINativeProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)
	const {
		models: dynamicOpenAiModels,
		refresh: refreshOpenAiNativeModels,
		isLoading: isLoadingOpenAiModels,
	} = useDynamicProviderModels({
		baseUrl: "https://api.openai.com/v1",
		apiKey: apiConfiguration?.openAiNativeApiKey,
		fallbackModels: openAiNativeModels,
		selectedModelId,
		selectedModelInfo,
		enabled: showModelOptions,
	})

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.openAiNativeApiKey || ""}
				onChange={(value) => handleFieldChange("openAiNativeApiKey", value)}
				providerName="OpenAI"
				signupUrl="https://platform.openai.com/api-keys"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={dynamicOpenAiModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>
					<VSCodeButton disabled={isLoadingOpenAiModels} onClick={() => refreshOpenAiNativeModels()}>
						{isLoadingOpenAiModels ? "Refreshing..." : "Refresh OpenAI models"}
					</VSCodeButton>

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
