import { type InterruptArtifactKernelRequest, InterruptArtifactKernelResponse } from "@shared/proto/cline/html_preview"
import type { Controller } from ".."

/**
 * Stop-only: this deliberately skips ensurePythonExecutionAllowed(). Interrupting can only
 * end code that is already running (or cancel runs that never started); it cannot start
 * or execute anything, so revoked or denied execution must still be able to stop a kernel.
 */
export async function interruptArtifactKernel(
	controller: Controller,
	request: InterruptArtifactKernelRequest,
): Promise<InterruptArtifactKernelResponse> {
	const artifactId = request.artifactId?.trim() || ""
	if (!artifactId) {
		return InterruptArtifactKernelResponse.create({
			recovered: false,
			error: "artifact_id is required",
		})
	}
	const result = await controller.getArtifactKernelService().interruptKernel(artifactId, request.profileId?.trim() || undefined)
	return InterruptArtifactKernelResponse.create({
		recovered: result.recovered,
		error: result.error ?? "",
	})
}
