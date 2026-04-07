import { anthropicModels, CLAUDE_SONNET_1M_SUFFIX } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ContextWindowSwitcher } from "../common/ContextWindowSwitcher"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useDynamicProviderModels } from "../utils/useDynamicProviderModels"

// Anthropic models that support thinking/reasoning mode
export const SUPPORTED_ANTHROPIC_THINKING_MODELS = [
	"claude-3-7-sonnet-20250219",
	"claude-sonnet-4-20250514",
	`claude-sonnet-4-20250514${CLAUDE_SONNET_1M_SUFFIX}`,
	"claude-opus-4-20250514",
	"claude-opus-4-1-20250805",
	"claude-sonnet-4-5-20250929",
	`claude-sonnet-4-5-20250929${CLAUDE_SONNET_1M_SUFFIX}`,
	"claude-haiku-4-5-20251001",
]

/**
 * Props for the AnthropicProvider component
 */
interface AnthropicProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Anthropic provider configuration component
 */
export const AnthropicProvider = ({ showModelOptions, isPopup, currentMode }: AnthropicProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)
	const {
		models: dynamicAnthropicModels,
		refresh: refreshAnthropicModels,
		isLoading: isLoadingAnthropicModels,
	} = useDynamicProviderModels({
		baseUrl: apiConfiguration?.anthropicBaseUrl || "https://api.anthropic.com",
		apiKey: apiConfiguration?.apiKey,
		fallbackModels: anthropicModels,
		selectedModelId,
		selectedModelInfo,
		enabled: showModelOptions,
	})

	// Helper function for model switching
	const handleModelChange = (modelId: string) => {
		handleModeFieldChange({ plan: "planModeApiModelId", act: "actModeApiModelId" }, modelId, currentMode)
	}

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.apiKey || ""}
				onChange={(value) => handleFieldChange("apiKey", value)}
				providerName="Anthropic"
				signupUrl="https://console.anthropic.com/settings/keys"
			/>

			<BaseUrlField
				initialValue={apiConfiguration?.anthropicBaseUrl}
				label="Use custom base URL"
				onChange={(value) => handleFieldChange("anthropicBaseUrl", value)}
				placeholder="Default: https://api.anthropic.com"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={dynamicAnthropicModels}
						onChange={(e) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>
					<VSCodeButton disabled={isLoadingAnthropicModels} onClick={() => refreshAnthropicModels()}>
						{isLoadingAnthropicModels ? "Refreshing..." : "Refresh Anthropic models"}
					</VSCodeButton>

					{/* Context window switcher for Claude Sonnet 4.5 */}
					<ContextWindowSwitcher
						base1mModelId={`claude-sonnet-4-5-20250929${CLAUDE_SONNET_1M_SUFFIX}`}
						base200kModelId="claude-sonnet-4-5-20250929"
						onModelChange={handleModelChange}
						selectedModelId={selectedModelId}
					/>

					{/* Context window switcher for Claude Sonnet 4 */}
					<ContextWindowSwitcher
						base1mModelId={`claude-sonnet-4-20250514${CLAUDE_SONNET_1M_SUFFIX}`}
						base200kModelId="claude-sonnet-4-20250514"
						onModelChange={handleModelChange}
						selectedModelId={selectedModelId}
					/>

					{SUPPORTED_ANTHROPIC_THINKING_MODELS.includes(selectedModelId) && (
						<ThinkingBudgetSlider currentMode={currentMode} maxBudget={selectedModelInfo.thinkingConfig?.maxBudget} />
					)}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
