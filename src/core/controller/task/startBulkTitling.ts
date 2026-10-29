import { EmptyRequest } from "@shared/proto/cline/common"
import { BulkTitlingResult } from "@shared/proto/cline/task"
import { Controller } from "../"

/** Title earlier chats with the configured model. Only ever called by the user's click on the History banner. */
export async function startBulkTitling(controller: Controller, _request: EmptyRequest): Promise<BulkTitlingResult> {
	const result = await controller.chatTitles.runBulk()
	await controller.postStateToWebview().catch(() => {})
	return BulkTitlingResult.create(result)
}
