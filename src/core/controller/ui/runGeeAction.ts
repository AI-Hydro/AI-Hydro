import type { StringRequest } from "@shared/proto/cline/common"
import { GeeStatusResponse } from "@shared/proto/cline/ui"
import { isGeeActionId } from "@shared/connectors"
import type { Controller } from "../index"
import { geeChooseProject } from "./geeChooseProject"
import { geeConnect } from "./geeConnect"
import { geeDisconnect } from "./geeDisconnect"
import { geeTest } from "./geeTest"

/**
 * RPC handler — runs ONE Earth Engine connector action chosen by the webview.
 *
 * The webview sends only an action id. Anything outside the hard-coded allowlist
 * (`GEE_ACTION_COMMANDS` in shared/connectors) is refused, so neither the remote
 * connectors catalog nor a compromised webview can select an arbitrary command.
 */
export async function runGeeAction(controller: Controller, request: StringRequest): Promise<GeeStatusResponse> {
	const actionId = request.value
	if (!isGeeActionId(actionId)) {
		console.warn(`[connectors] refusing non-allowlisted GEE action ${JSON.stringify(actionId)}`)
		return GeeStatusResponse.create({ ok: false, authenticated: false, message: "Unknown connector action" })
	}
	switch (actionId) {
		case "connect":
			return geeConnect(controller, {})
		case "configure":
			return geeChooseProject(controller, {})
		case "disconnect":
			return geeDisconnect(controller, {})
		case "test":
			return geeTest(controller, {})
	}
}
