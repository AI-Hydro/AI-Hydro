import type { ModelFamily } from "@/shared/prompts"
import type { AiHydroDefaultTool } from "@/shared/tools"
import type { SystemPromptContext } from "./types"

export interface AiHydroToolSpec {
	variant: ModelFamily
	id: AiHydroDefaultTool
	name: string
	description: string
	instruction?: string
	contextRequirements?: (context: SystemPromptContext) => boolean
	parameters?: Array<AiHydroToolSpecParameter>
}

interface AiHydroToolSpecParameter {
	name: string
	required: boolean
	instruction: string
	usage?: string
	dependencies?: AiHydroDefaultTool[]
	description?: string
	contextRequirements?: (context: SystemPromptContext) => boolean
}
