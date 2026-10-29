import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { Controller } from "../"

export async function cancelBulkTitling(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	controller.chatTitles.cancelBulk()
	return Empty.create({})
}
