import type { CommandContext, Empty } from "@/shared/proto/index.cline"
import type { Controller } from "../index"
import { explainWithAiHydro } from "./explainWithAiHydro"

export async function explainWithCline(controller: Controller, request: CommandContext): Promise<Empty> {
	return explainWithAiHydro(controller, request)
}
