import { ModelFamily } from "@/shared/prompts"
import type { AiHydroToolSpec } from "../spec"

export class AiHydroToolSet {
	// A list of tools mapped by model group
	private static variants: Map<ModelFamily, Set<AiHydroToolSet>> = new Map()

	private constructor(
		public readonly id: string,
		public readonly config: AiHydroToolSpec,
	) {
		this._register()
	}

	public static register(config: AiHydroToolSpec): AiHydroToolSet {
		return new AiHydroToolSet(config.id, config)
	}

	private _register(): void {
		const existingTools = AiHydroToolSet.variants.get(this.config.variant) || new Set()
		if (!Array.from(existingTools).some((t) => t.config.id === this.config.id)) {
			existingTools.add(this)
			AiHydroToolSet.variants.set(this.config.variant, existingTools)
		}
	}

	public static getTools(variant: ModelFamily): AiHydroToolSet[] {
		const toolsSet = AiHydroToolSet.variants.get(variant) || new Set()
		const defaultSet = AiHydroToolSet.variants.get(ModelFamily.GENERIC) || new Set()

		return toolsSet ? Array.from(toolsSet) : Array.from(defaultSet)
	}

	public static getRegisteredModelIds(): string[] {
		return Array.from(AiHydroToolSet.variants.keys())
	}

	public static getToolByName(toolName: string, variant: ModelFamily): AiHydroToolSet | undefined {
		const tools = AiHydroToolSet.getTools(variant)
		return tools.find((tool) => tool.config.id === toolName)
	}

	// Return a tool by name with fallback to GENERIC and then any other variant where it exists
	public static getToolByNameWithFallback(toolName: string, variant: ModelFamily): AiHydroToolSet | undefined {
		// Try exact variant first
		const exact = AiHydroToolSet.getToolByName(toolName, variant)
		if (exact) {
			return exact
		}

		// Fallback to GENERIC
		const generic = AiHydroToolSet.getToolByName(toolName, ModelFamily.GENERIC)
		if (generic) {
			return generic
		}

		// Final fallback: search across all registered variants
		for (const [, tools] of AiHydroToolSet.variants) {
			const found = Array.from(tools).find((t) => t.config.id === toolName)
			if (found) {
				return found
			}
		}

		return undefined
	}

	// Build a list of tools for a variant using requested ids, falling back to GENERIC when missing
	public static getToolsForVariantWithFallback(variant: ModelFamily, requestedIds: string[]): AiHydroToolSet[] {
		const resolved: AiHydroToolSet[] = []
		for (const id of requestedIds) {
			const tool = AiHydroToolSet.getToolByNameWithFallback(id, variant)
			if (tool) {
				// Avoid duplicates by id
				if (!resolved.some((t) => t.config.id === tool.config.id)) {
					resolved.push(tool)
				}
			}
		}
		return resolved
	}
}
