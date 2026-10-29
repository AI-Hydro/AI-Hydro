import type { AiHydroMessage } from "@shared/ExtensionMessage"
import type { ChatExchange } from "./ChatTitleService"

/**
 * What a title may be made from, read out of a chat's messages: the first assistant reply and the names of the tools
 * used. Tool arguments and tool results are never read (PSMH §4.1: no tool outputs), so a result value cannot reach
 * the title prompt or, through a model, a title.
 */
export function exchangeFromMessages(messages: readonly AiHydroMessage[]): ChatExchange {
	let firstAssistantText: string | undefined
	const toolNames: string[] = []
	for (let i = 1; i < messages.length; i++) {
		const m = messages[i]
		if (
			!firstAssistantText &&
			m.type === "say" &&
			(m.say === "text" || m.say === "completion_result") &&
			m.text &&
			!m.partial
		) {
			firstAssistantText = m.text
		}
		if (toolNames.length < 12 && (m.say === "use_mcp_server" || m.ask === "use_mcp_server") && m.text) {
			try {
				const name = (JSON.parse(m.text) as { toolName?: unknown }).toolName
				if (typeof name === "string") {
					toolNames.push(name)
				}
			} catch {
				// not a tool request row
			}
		} else if (toolNames.length < 12 && m.say === "tool" && m.text) {
			try {
				const name = (JSON.parse(m.text) as { tool?: unknown }).tool
				if (typeof name === "string") {
					toolNames.push(name)
				}
			} catch {
				// not a tool row
			}
		}
	}
	return { ...(firstAssistantText ? { firstAssistantText } : {}), toolNames }
}
