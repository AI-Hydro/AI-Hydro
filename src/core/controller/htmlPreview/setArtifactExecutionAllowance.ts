import {
	type SetArtifactExecutionAllowanceRequest,
	SetArtifactExecutionAllowanceResponse,
} from "@shared/proto/cline/html_preview"
import type { Controller } from ".."

/**
 * Allow or revoke Python/agent execution for one document. The service refuses
 * to allow a document whose source is not trusted, so this RPC cannot upgrade a
 * static or unsigned document. Revoking also stops that document's kernel so the
 * badge reflects what is actually running.
 */
export async function setArtifactExecutionAllowance(
	controller: Controller,
	request: SetArtifactExecutionAllowanceRequest,
): Promise<SetArtifactExecutionAllowanceResponse> {
	const artifactId = request.artifactId?.trim() || ""
	if (!artifactId) {
		return SetArtifactExecutionAllowanceResponse.create({ allowed: false })
	}
	const allowed = controller.setArtifactExecutionAllowed(artifactId, Boolean(request.allowed))
	return SetArtifactExecutionAllowanceResponse.create({ allowed })
}
