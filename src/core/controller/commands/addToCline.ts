import type { CommandContext, Empty } from "@/shared/proto/index.cline"
import type { Controller } from "../index"
import { addToAiHydro } from "./addToAiHydro"

export async function addToCline(controller: Controller, request: CommandContext): Promise<Empty> {
	return addToAiHydro(controller, request)
}
