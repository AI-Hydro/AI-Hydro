import type { EmptyRequest } from "@shared/proto/cline/common"
import { GeeStatusResponse } from "@shared/proto/cline/ui"
import * as vscode from "vscode"
import type { Controller } from "../index"

export async function geeTest(_controller: Controller, _request: EmptyRequest): Promise<GeeStatusResponse> {
	try {
		const result = (await vscode.commands.executeCommand("aihydro.gee.test")) as
			| {
					ok?: boolean
					authenticated?: boolean
					project_id?: string
					message?: string
					runtime?: { ee_version?: string; python_executable?: string }
			  }
			| undefined
		if (!result) {
			return GeeStatusResponse.create({ ok: false, authenticated: false, message: "No response from GEE test command" })
		}
		return GeeStatusResponse.create({
			ok: result.ok ?? false,
			authenticated: result.authenticated ?? false,
			projectId: result.project_id ?? "",
			eeVersion: result.runtime?.ee_version ?? "",
			pythonExecutable: result.runtime?.python_executable ?? "",
			message: result.message ?? "",
		})
	} catch (error) {
		return GeeStatusResponse.create({ ok: false, authenticated: false, message: String(error) })
	}
}
