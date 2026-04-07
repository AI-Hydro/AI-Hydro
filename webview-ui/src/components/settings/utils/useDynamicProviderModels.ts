import { ModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import { OpenAiModelsRequest } from "@shared/proto/cline/models"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ModelsServiceClient } from "@/services/grpc-client"

interface UseDynamicProviderModelsParams {
	baseUrl?: string
	apiKey?: string
	fallbackModels: Record<string, ModelInfo>
	selectedModelId?: string
	selectedModelInfo?: ModelInfo
	enabled?: boolean
}

interface UseDynamicProviderModelsResult {
	models: Record<string, ModelInfo>
	refresh: () => Promise<void>
	isLoading: boolean
}

export function useDynamicProviderModels({
	baseUrl,
	apiKey,
	fallbackModels,
	selectedModelId,
	selectedModelInfo,
	enabled = true,
}: UseDynamicProviderModelsParams): UseDynamicProviderModelsResult {
	const [dynamicModelIds, setDynamicModelIds] = useState<string[]>([])
	const [isLoading, setIsLoading] = useState(false)

	const refresh = useCallback(async () => {
		if (!enabled || !baseUrl || !apiKey) {
			setDynamicModelIds([])
			return
		}

		setIsLoading(true)
		try {
			const response = await ModelsServiceClient.refreshOpenAiModels(
				OpenAiModelsRequest.create({
					baseUrl,
					apiKey,
				}),
			)
			setDynamicModelIds(response?.values ?? [])
		} catch (error) {
			console.error("Failed to refresh provider models:", error)
			setDynamicModelIds([])
		} finally {
			setIsLoading(false)
		}
	}, [apiKey, baseUrl, enabled])

	useEffect(() => {
		refresh()
	}, [refresh])

	const models = useMemo(() => {
		if (!dynamicModelIds.length) {
			return fallbackModels
		}

		const dynamicModels: Record<string, ModelInfo> = {}
		for (const modelId of dynamicModelIds) {
			dynamicModels[modelId] = fallbackModels[modelId] ||
				(selectedModelId === modelId ? selectedModelInfo : undefined) || {
					...openAiModelInfoSaneDefaults,
					description: "Model metadata unavailable from provider API",
				}
		}

		return dynamicModels
	}, [dynamicModelIds, fallbackModels, selectedModelId, selectedModelInfo])

	return { models, refresh, isLoading }
}
