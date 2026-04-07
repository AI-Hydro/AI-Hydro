import type { CommandContext, Empty } from "@/shared/proto/index.cline"
import type { Controller } from "../index"
import { improveWithAiHydro } from "./improveWithAiHydro"

export async function improveWithCline(controller: Controller, request: CommandContext): Promise<Empty> {
	return improveWithAiHydro(controller, request)
}
