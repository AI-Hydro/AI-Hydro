import { ModelFamily } from "@/shared/prompts"
import { AiHydroDefaultTool } from "@/shared/tools"
import type { AiHydroToolSpec } from "../spec"

// HACK: Placeholder to act as tool dependency
const generic: AiHydroToolSpec = {
	variant: ModelFamily.GENERIC,
	id: AiHydroDefaultTool.TODO,
	name: "focus_chain",
	description: "",
	contextRequirements: (context) => context.focusChainSettings?.enabled === true,
}

const nextGen = { ...generic, variant: ModelFamily.NEXT_GEN }
const gpt = { ...generic, variant: ModelFamily.GPT }
const gemini = { ...generic, variant: ModelFamily.GEMINI }

export const focus_chain_variants = [generic, nextGen, gpt, gemini]
