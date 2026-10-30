import { Empty, StringRequest } from "@shared/proto/cline/common"
import type { Controller } from ".."
import { reportSidebarView } from "./sidebarView"

/** The webview reports the sidebar view it is now showing; the host mirrors it into a context key. */
export async function setSidebarView(_controller: Controller, request: StringRequest): Promise<Empty> {
	reportSidebarView(request.value)
	return Empty.create()
}
