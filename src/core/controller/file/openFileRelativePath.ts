import { openFile as openFileIntegration } from "@integrations/misc/open-file"
import { aihydroHome } from "@shared/aihydro/aihydroHome"
import { Empty, StringRequest } from "@shared/proto/cline/common"
import { Controller } from ".."
import { chipRoots, resolveChipPath } from "./workspaceScope"

/**
 * Opens a file in the editor by a path from a chat chip: relative to any workspace root, or absolute inside a
 * workspace root or a tool-output location. Anything else is refused (see `workspaceScope.ts`).
 */
export async function openFileRelativePath(_controller: Controller, request: StringRequest): Promise<Empty> {
	const roots = await chipRoots()
	if (roots.length === 0) {
		console.error("Error in openFileRelativePath: No workspace path available")
		return Empty.create()
	}
	if (request.value) {
		const absolutePath = resolveChipPath(roots, aihydroHome(), request.value, false)
		if (!absolutePath) {
			console.error(`openFileRelativePath: refusing a path outside the workspace and tool outputs: ${request.value}`)
			return Empty.create()
		}
		openFileIntegration(absolutePath)
	}
	return Empty.create()
}
