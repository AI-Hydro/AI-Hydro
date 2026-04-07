import type { CommandContext, Empty } from "@/shared/proto/index.cline"
import type { Controller } from "../index"
import { fixWithAiHydro } from "./fixWithAiHydro"

export async function fixWithCline(controller: Controller, request: CommandContext): Promise<Empty> {
	return fixWithAiHydro(controller, request)
}
