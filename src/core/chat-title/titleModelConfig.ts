import type { ApiConfiguration } from "@shared/api"
import type { Mode } from "@shared/storage/types"

/**
 * The API configuration for a title call (PSMH §4.1). With no `titleModel` it is the chat's own configuration. With
 * one, the model id of the mode in use is replaced; the provider, key and endpoint stay the chat's, so a title call
 * goes to the provider the user already chose and nowhere new.
 *
 * Providers keep their model id under different keys (`actModeApiModelId`, `actModeOpenRouterModelId`, ...). Only the
 * active provider's key is read when the handler is built, so every `<mode>Mode*ModelId` key that is already set is
 * replaced, and `<mode>ModeApiModelId` always. A provider that has no id set (it uses its default model) keeps it.
 * The provider's model metadata (context size, price) stays that of the chat model.
 */
export function withTitleModel(config: ApiConfiguration, mode: Mode, titleModel: string | undefined): ApiConfiguration {
	const model = titleModel?.trim()
	if (!model) {
		return config
	}
	const next: Record<string, unknown> = { ...config }
	const pattern = new RegExp(`^${mode}Mode.*ModelId$`)
	for (const key of Object.keys(next)) {
		if (pattern.test(key) && typeof next[key] === "string" && next[key]) {
			next[key] = model
		}
	}
	next[`${mode}ModeApiModelId`] = model
	return next as ApiConfiguration
}
