/**
 * Which asks are answered on the card that raised them, and which asks block the agent on the user (the view badge).
 * Pure: no React, no VS Code.
 */
import type { AiHydroAsk, AiHydroMessage } from "../ExtensionMessage"
import { APPROVAL_ASKS } from "./askOutcome"

/**
 * A complete (not streaming) run/deny ask. Its Run/Deny buttons live on its own card, not in the footer. Unknown ask
 * kinds are never inline: they keep the footer's fail-safe Run/Deny (buttonConfig).
 */
export function isInlineApprovalAsk(message: AiHydroMessage | undefined): boolean {
	return !!message && message.type === "ask" && message.partial !== true && !!message.ask && APPROVAL_ASKS.includes(message.ask)
}

/**
 * Tooltip for the sidebar view badge while the agent is blocked on the user, or undefined for asks that are not a
 * mid-task block. The lifecycle asks (a finished answer, resuming a task, a command's live output) are not: the
 * agent is not waiting on the user to continue its work.
 *
 * Exhaustive over AiHydroAsk with a `never` check, so a new ask kind cannot be added without deciding.
 */
export function badgeForAsk(ask: AiHydroAsk): string | undefined {
	switch (ask) {
		case "tool":
		case "command":
		case "use_mcp_server":
		case "browser_action_launch":
			return "AI-Hydro is waiting for your approval"
		case "followup":
		case "plan_mode_respond":
			return "AI-Hydro is waiting for your reply"
		case "api_req_failed":
			return "AI-Hydro: the request failed and is waiting for you"
		case "mistake_limit_reached":
		case "auto_approval_max_req_reached":
			return "AI-Hydro paused and is waiting for you"
		case "install_dependencies":
		case "workspace_env_setup":
		case "new_task":
		case "condense":
		case "report_bug":
			return "AI-Hydro is waiting for your decision"
		case "completion_result":
		case "resume_task":
		case "resume_completed_task":
		case "command_output":
		case "summarize_task":
			return undefined
		default: {
			const unreachable: never = ask
			void unreachable
			return undefined
		}
	}
}
