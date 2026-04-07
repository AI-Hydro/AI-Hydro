import type { Empty, EmptyRequest } from "@shared/proto/cline/common"
import type { Controller } from ".."
import { installAiHydroCli } from "./installAiHydroCli"

export async function installClineCli(controller: Controller, request: EmptyRequest): Promise<Empty> {
	return installAiHydroCli(controller, request)
}
