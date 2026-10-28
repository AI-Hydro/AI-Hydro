import type { BrowserSettings } from "@shared/BrowserSettings"
import { AiHydroDefaultTool } from "@/shared/tools"

export const BROWSER_TOOL_OFF_MESSAGE =
	"The browser tool is turned off. The user can turn it on in AI-Hydro Settings > Browser. Use other tools."

/**
 * The browser tool is off by default (X0-5). The prompt omits it, but a model can still emit the call (history, older
 * prompts), so the host refuses it here. Only an explicit `disableToolUse === true` refuses, which is also the
 * shipped default; settings that were never merged with defaults (tests, mocks) do not.
 */
export function browserToolRefusal(
	toolName: string | undefined,
	browserSettings: Partial<BrowserSettings> | undefined,
): string | undefined {
	return toolName === AiHydroDefaultTool.BROWSER && browserSettings?.disableToolUse === true
		? BROWSER_TOOL_OFF_MESSAGE
		: undefined
}
