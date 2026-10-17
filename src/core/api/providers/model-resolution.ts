import type { ModelInfo } from "@shared/api"

/**
 * Thrown when a user-selected model id is not in a provider's static registry.
 *
 * Before this existed every provider silently substituted its default model, so a researcher who
 * typed `claude-opus-5-5` was served Sonnet 4.6 with no indication. That is a provenance defect: the
 * model that produced a result must be the model the user selected (or the run must fail loudly).
 */
export class UnknownModelError extends Error {
	constructor(
		public readonly provider: string,
		public readonly modelId: string,
		public readonly knownModelCount: number,
	) {
		super(
			`Unknown ${provider} model "${modelId}". It is not in AI-Hydro's ${provider} model registry ` +
				`(${knownModelCount} models), so the request was NOT sent and no other model was substituted. ` +
				`Select a listed model in Settings > API Provider, or add "${modelId}" to the ${provider} model ` +
				`registry in src/shared/api.ts (with its context window, pricing and capability flags).`,
		)
		this.name = "UnknownModelError"
	}
}

/**
 * Resolve the model a handler should report from getModel().
 *
 * getModel() is called from many non-request paths (telemetry, context-window sizing, settings
 * handlers, error reporting) so it must never throw. For an id that is not in the registry it returns
 * the id verbatim (never the default's id) with the default model's info as a stand-in; the actual
 * refusal happens in {@link assertKnownModel}, called at the start of every request.
 */
export function resolveRegistryModel<Id extends string>(args: {
	registry: Readonly<Record<string, ModelInfo>>
	defaultId: Id
	requestedId: string | undefined
}): { id: Id; info: ModelInfo } {
	const { registry, defaultId, requestedId } = args
	if (!requestedId) {
		return { id: defaultId, info: registry[defaultId] }
	}
	if (requestedId in registry) {
		return { id: requestedId as Id, info: registry[requestedId] }
	}
	return { id: requestedId as Id, info: registry[defaultId] }
}

/** Throws {@link UnknownModelError} if a model id was requested that the registry does not contain. */
export function assertKnownModel(provider: string, requestedId: string | undefined, registry: Readonly<Record<string, unknown>>) {
	if (requestedId && !(requestedId in registry)) {
		throw new UnknownModelError(provider, requestedId, Object.keys(registry).length)
	}
}
