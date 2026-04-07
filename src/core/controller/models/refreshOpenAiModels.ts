import { StringArray } from "@shared/proto/cline/common"
import { OpenAiModelsRequest } from "@shared/proto/cline/models"
import type { AxiosRequestConfig } from "axios"
import axios from "axios"
import { Controller } from ".."

/**
 * Fetches available models from the OpenAI API
 * @param controller The controller instance
 * @param request Request containing the base URL and API key
 * @returns Array of model names
 */
export async function refreshOpenAiModels(_controller: Controller, request: OpenAiModelsRequest): Promise<StringArray> {
	try {
		if (!request.baseUrl) {
			return StringArray.create({ values: [] })
		}

		if (!URL.canParse(request.baseUrl)) {
			return StringArray.create({ values: [] })
		}

		const normalizedBaseUrl = request.baseUrl.replace(/\/+$/, "")
		const lowerBaseUrl = normalizedBaseUrl.toLowerCase()
		const isAnthropic = lowerBaseUrl.includes("anthropic.com")
		const isGemini = lowerBaseUrl.includes("generativelanguage.googleapis.com")

		const config: AxiosRequestConfig = { timeout: 15000 }

		let url = `${normalizedBaseUrl}/models`
		if (isAnthropic) {
			// Anthropic list models endpoint.
			url = lowerBaseUrl.endsWith("/v1") ? `${normalizedBaseUrl}/models` : `${normalizedBaseUrl}/v1/models`
		} else if (isGemini) {
			// Gemini list models endpoint.
			url = lowerBaseUrl.includes("/v1beta/models")
				? normalizedBaseUrl
				: lowerBaseUrl.endsWith("/v1beta")
					? `${normalizedBaseUrl}/models`
					: `${normalizedBaseUrl}/v1beta/models`
		}

		if (request.apiKey) {
			if (isAnthropic) {
				config.headers = {
					"x-api-key": request.apiKey,
					"anthropic-version": "2023-06-01",
				}
			} else if (isGemini) {
				config.params = { key: request.apiKey }
			} else {
				config.headers = { Authorization: `Bearer ${request.apiKey}` }
			}
		}

		const response = await axios.get(url, config)
		const data = response.data

		const modelsArray: string[] =
			// OpenAI-compatible shape.
			(
				data?.data?.map((model: any) => model?.id) ||
				// Gemini shape.
				data?.models?.map((model: any) => {
					const name = model?.name
					return typeof name === "string" && name.startsWith("models/") ? name.slice("models/".length) : name
				}) ||
				[]
			).filter((id: unknown): id is string => typeof id === "string" && id.length > 0)

		const models = [...new Set<string>(modelsArray)]

		return StringArray.create({ values: models })
	} catch (error) {
		console.error("Error fetching OpenAI models:", error)
		return StringArray.create({ values: [] })
	}
}
