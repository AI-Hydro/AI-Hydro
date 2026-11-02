import type { ApiConfiguration, ApiProvider } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import type { AgentDefinition } from "./agentDefinition"

/**
 * Which model a child runs (orchestration report 5.10). A definition either inherits the parent's model or reads the
 * user's `agentModels` setting. A model id is on the parent's provider unless the user names another provider for a
 * definition that allows it (owner decision D7): then the child's prompts go to a second vendor, and the launch card
 * says so. Nothing here reads a key the user did not already configure, and an id or provider that cannot be applied is
 * an error the model is told, never a silent fallback to the parent's model.
 */

/** The user's choice for one definition, as stored in `agentModels`. */
export interface AgentModelChoice {
	modelId: string
	providerId?: string
}

/**
 * Providers whose model id can be set on a copy of the configuration, with the key suffix each reads. "Api" is the
 * shared `<mode>ModeApiModelId`. Providers with several model keys (SAP AI Core) or none (VS Code LM, Dify) are absent
 * on purpose: an override there would not do what it says.
 */
const MODEL_KEY: Readonly<Partial<Record<ApiProvider, string>>> = {
	anthropic: "Api",
	bedrock: "Api",
	vertex: "Api",
	gemini: "Api",
	"openai-native": "Api",
	deepseek: "Api",
	qwen: "Api",
	"qwen-code": "Api",
	doubao: "Api",
	mistral: "Api",
	moonshot: "Api",
	nebius: "Api",
	asksage: "Api",
	xai: "Api",
	sambanova: "Api",
	cerebras: "Api",
	"claude-code": "Api",
	zai: "Api",
	openrouter: "OpenRouter",
	openai: "OpenAi",
	ollama: "Ollama",
	lmstudio: "LmStudio",
	litellm: "LiteLlm",
	requesty: "Requesty",
	fireworks: "Fireworks",
	together: "Together",
	huggingface: "HuggingFace",
	groq: "Groq",
	baseten: "Baseten",
	"huawei-cloud-maas": "HuaweiCloudMaas",
	"vercel-ai-gateway": "VercelAiGateway",
}

export type ChildApiResolution =
	| {
			ok: true
			/** The configuration the child's handler is built from. Present only when the model is overridden. */
			config?: ApiConfiguration
			mode: Mode
			/** The provider the child's requests go to. Known only when the model is overridden. */
			providerId?: ApiProvider
			/** True when the child runs a model other than the parent's (so the launch card names it). */
			overridden: boolean
			/** True when the provider is not the parent's. The prompts then leave for another vendor. */
			otherProvider: boolean
	  }
	| { ok: false; error: string }

function keyFor(provider: string | undefined): string | undefined {
	return provider && Object.hasOwn(MODEL_KEY, provider) ? MODEL_KEY[provider as ApiProvider] : undefined
}

function isChoice(value: unknown): value is AgentModelChoice {
	const v = value as AgentModelChoice | undefined
	return (
		!!v &&
		typeof v === "object" &&
		typeof v.modelId === "string" &&
		v.modelId.trim().length > 0 &&
		(v.providerId === undefined || typeof v.providerId === "string")
	)
}

/** The setting for a definition: its own id, then the built-in a file extends. A malformed entry is an error, not a skip. */
function settingFor(definition: AgentDefinition, settings: unknown): AgentModelChoice | undefined | "invalid" {
	if (!settings || typeof settings !== "object") {
		return undefined
	}
	for (const key of [definition.id, definition.extends]) {
		if (key && Object.hasOwn(settings, key)) {
			const value = (settings as Record<string, unknown>)[key]
			return isChoice(value)
				? { modelId: value.modelId.trim(), providerId: value.providerId?.trim() || undefined }
				: "invalid"
		}
	}
	return undefined
}

/** Set the model id (and clear a stale model-info record) for `provider` and `mode` on a copy of the configuration. */
function withModel(config: ApiConfiguration, mode: Mode, provider: ApiProvider, modelId: string): ApiConfiguration | undefined {
	const name = keyFor(provider)
	if (!name) {
		return undefined
	}
	const prefix = mode === "plan" ? "planMode" : "actMode"
	const next: Record<string, unknown> = { ...config, [`${prefix}${name}ModelId`]: modelId }
	if (name !== "Api") {
		// The saved info belongs to the parent's model; the handler looks the child's model up by id.
		next[`${prefix}${name}ModelInfo`] = undefined
	}
	return next as ApiConfiguration
}

/**
 * The configuration a definition's children run with. `base` is the parent's; it is copied, never changed.
 * `inherit` with no file model returns it as it is.
 */
export function resolveChildApi(
	getBase: () => ApiConfiguration,
	mode: Mode,
	definition: AgentDefinition,
	settings: unknown,
): ChildApiResolution {
	const fromSetting = definition.model === "setting" ? settingFor(definition, settings) : undefined
	if (fromSetting === "invalid") {
		return {
			ok: false,
			error: `The agentModels setting for '${definition.id}' is not { modelId, providerId? }. Fix it in settings, or do the work yourself.`,
		}
	}
	const choice: AgentModelChoice | undefined = fromSetting ?? (definition.modelId ? { modelId: definition.modelId } : undefined)
	if (!choice) {
		// Nothing to apply: the parent's configuration is not even read.
		return { ok: true, mode, overridden: false, otherProvider: false }
	}
	const base = getBase()
	const parentProvider = mode === "plan" ? base.planModeApiProvider : base.actModeApiProvider
	const provider = (choice.providerId as ApiProvider | undefined) ?? parentProvider
	const otherProvider = provider !== parentProvider
	if (otherProvider && !definition.crossProvider) {
		return {
			ok: false,
			error: `'${definition.id}' may not use a different provider ('${choice.providerId}'): its model must be on the parent's provider. Remove providerId from the agentModels setting, or do the work yourself.`,
		}
	}
	if (!keyFor(provider)) {
		return {
			ok: false,
			error: `A model for '${definition.id}' cannot be set on provider '${provider ?? "unknown"}'. Use a provider that takes a model id, or remove the agentModels entry.`,
		}
	}
	const config = withModel(base, mode, provider as ApiProvider, choice.modelId)
	if (!config) {
		return { ok: false, error: `A model for '${definition.id}' cannot be set on provider '${provider}'.` }
	}
	return {
		ok: true,
		config: otherProvider
			? ({ ...config, [mode === "plan" ? "planModeApiProvider" : "actModeApiProvider"]: provider } as ApiConfiguration)
			: config,
		mode,
		providerId: provider,
		overridden: true,
		otherProvider,
	}
}
