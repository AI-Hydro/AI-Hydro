import { aihydroHome } from "@shared/aihydro/aihydroHome"
import { BooleanResponse, StringRequest } from "@shared/proto/cline/common"
import { Controller } from ".."
import { chipRoots, resolveChipPath } from "./workspaceScope"

/**
 * Whether a chip may be shown for a path: it must be an existing file in ANY workspace root or in a tool-output
 * location (see `workspaceScope.ts`). A model must not be able to offer a clickable `~/.ssh/...` link.
 */
export async function ifFileExistsRelativePath(_controller: Controller, request: StringRequest): Promise<BooleanResponse> {
	const roots = await chipRoots()
	if (roots.length === 0) {
		console.error("Error in ifFileExistsRelativePath: No workspace path available")
		return BooleanResponse.create({ value: false })
	}
	if (!request.value) {
		return BooleanResponse.create({ value: false })
	}
	return BooleanResponse.create({ value: resolveChipPath(roots, aihydroHome(), request.value, true) !== undefined })
}
