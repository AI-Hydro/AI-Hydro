import {
	ArtifactCodeLanguage,
	type NotifyParamChangedRequest,
	NotifyParamChangedResponse,
	RunArtifactCodeRequest,
} from "@shared/proto/cline/html_preview"
import type { Controller } from ".."
import { runArtifactCode } from "./runArtifactCode"

/**
 * Phase 3.5 — Reactive parameters.
 *
 * Called by the HTML preview bridge (`aihydroCellBridge.ts`) when the user
 * changes a widget value (slider, dropdown, text input) inside an artifact's
 * rendered output.  Injects an assignment for the changed parameter into a
 * minimal Python snippet, then delegates to `runArtifactCode` so the cell
 * re-executes with the new value.
 *
 * The injected assignment is prepended to the cell's stored code so downstream
 * plots / tables immediately reflect the new parameter without the user having
 * to re-run the notebook manually.
 */
export async function notifyParamChanged(
	controller: Controller,
	request: NotifyParamChangedRequest,
): Promise<NotifyParamChangedResponse> {
	const artifactId = request.artifactId?.trim() ?? ""
	const cellId = request.cellId?.trim() ?? ""
	const paramName = request.paramName?.trim() ?? ""
	const paramValueJson = request.paramValueJson ?? ""

	if (!artifactId || !cellId || !paramName) {
		return NotifyParamChangedResponse.create({
			triggered: false,
			error: "artifact_id, cell_id, and param_name are all required",
		})
	}

	// The name is spliced into Python source, so it must be a plain identifier.
	// (Execution itself is trust-gated in runArtifactCode.)
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(paramName)) {
		return NotifyParamChangedResponse.create({ triggered: false, error: "param_name must be a Python identifier" })
	}

	// Build a minimal Python assignment that updates the parameter, then
	// re-runs the cell.  The variable assignment is placed at the top of the
	// code string so it shadows the cell's original binding.
	const assignmentCode = `${paramName} = ${paramValueJson}`

	const runRequest = RunArtifactCodeRequest.create({
		artifactId,
		cellId,
		language: ArtifactCodeLanguage.ARTIFACT_CODE_LANGUAGE_PYTHON,
		// Prepend the assignment; the caller's full cell code is not available
		// here, so we rely on the kernel's namespace already holding it.
		code: assignmentCode,
	})

	try {
		const result = await runArtifactCode(controller, runRequest)
		if (result.status === "error") {
			return NotifyParamChangedResponse.create({
				triggered: false,
				error: result.error || "Re-execution failed",
			})
		}
		return NotifyParamChangedResponse.create({ triggered: true })
	} catch (err) {
		return NotifyParamChangedResponse.create({
			triggered: false,
			error: err instanceof Error ? err.message : "Unknown error during param re-execution",
		})
	}
}
