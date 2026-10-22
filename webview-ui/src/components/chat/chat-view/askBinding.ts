import { AskResponseRequest } from "@shared/proto/cline/task"
import { TaskServiceClient } from "@/services/grpc-client"

export const STALE_ASK_NOTICE = "That request changed — review again"

/**
 * Sends an ask response bound to the ask it answers (W2-E1, M-1). `askTs` must be the ts of the ask message being
 * answered. The webview never sends 0: the host reads 0 as "unbound" (internal callers only), so when there is no
 * ask to name, callers pass the last message's ts or NO_ASK_TS and the host reports the response stale.
 * Resolves true when the host dropped the response as stale.
 */
export async function sendBoundAskResponse(fields: Partial<AskResponseRequest>, askTs: number): Promise<boolean> {
	const result = await TaskServiceClient.askResponse(AskResponseRequest.create({ ...fields, askTs: askTs || NO_ASK_TS }))
	return result?.stale === true
}

/** Never equals a real ask ts (those are Date.now() values), and is not 0 (the unbound path). */
export const NO_ASK_TS = -1
