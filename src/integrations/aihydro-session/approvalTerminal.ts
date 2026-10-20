/**
 * ADR-002b A4: "Approve in terminal" for APPROVAL_REQUIRED tool refusals.
 *
 * The extension is a UX client only. It never signs, holds keys, or writes
 * approvals: it opens a terminal and TYPES the backend-provided
 * `approval_command` WITHOUT a trailing newline, so a human must press Enter
 * and complete the signing CLI's own prompt (the CLI is canonical).
 *
 * This module deliberately does not import `vscode`; the window API is
 * injected so core code stays host-agnostic and tests can mock it.
 */
import { type ApprovalRequiredResult, parseApprovalRequired } from "@shared/aihydro/claimApproval"
import type { ServerConnectionView } from "@shared/aihydro/firstPartyServers"

export interface TerminalLike {
	show(): void
	sendText(text: string, addNewLine?: boolean): void
}

export interface ApprovalWindow {
	createTerminal(options: { name: string; env?: Record<string, string | null | undefined> }): TerminalLike
	showWarningMessage(message: string, ...items: string[]): PromiseLike<string | undefined>
}

export const APPROVE_IN_TERMINAL = "Approve in terminal"

/**
 * Agent-context markers the approval terminal must NOT carry (approval redesign AP1, B4). The approval CLI refuses
 * to approve a claim when any of them is set, so a terminal that inherited one (for example VS Code launched with
 * `code .` from an agent terminal) would refuse the human. `null` asks VS Code to remove the variable from the
 * terminal's environment (the `TerminalOptions.env` type accepts `string | null | undefined`). The extension never
 * sets these on this terminal, so this is a belt-and-braces clear, and tests assert the options we pass.
 */
export const APPROVAL_TERMINAL_CLEARED_ENV: Readonly<Record<string, null>> = Object.freeze({
	AIHYDRO_AGENT_CONTEXT: null,
	AIHYDRO_ACTIVE: null,
	AIHYDRO_PROFILE: null,
})

/** A command containing any control character (notably CR/LF) could auto-execute when typed. */
export function isSafeApprovalCommand(command: string): boolean {
	return command.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(command)
}

/** Open a terminal and type (not run) the approval command. Returns false when refused as unsafe. */
export function openApprovalTerminal(command: string, host: Pick<ApprovalWindow, "createTerminal">): boolean {
	if (!isSafeApprovalCommand(command)) {
		return false
	}
	const terminal = host.createTerminal({ name: "AI-Hydro approval", env: { ...APPROVAL_TERMINAL_CLEARED_ENV } })
	terminal.show()
	terminal.sendText(command, false)
	return true
}

export type ApprovalPrompter = (result: ApprovalRequiredResult) => void

let prompter: ApprovalPrompter | undefined

export function setApprovalPrompter(next: ApprovalPrompter | undefined): void {
	prompter = next
}

/** Prompter that offers the action as a notification; the user must click, then press Enter in the terminal. */
export function createApprovalPrompter(host: ApprovalWindow): ApprovalPrompter {
	return (result) => {
		if (!result.ok) {
			void host.showWarningMessage(`AI-Hydro: ${result.message}`)
			return
		}
		const { approvalCommand } = result.approval
		void host
			.showWarningMessage(
				`Claim promotion needs your approval. This opens a terminal with \`${approvalCommand}\` typed but not run; review it and press Enter yourself.`,
				APPROVE_IN_TERMINAL,
			)
			.then((choice) => {
				if (choice === APPROVE_IN_TERMINAL) {
					openApprovalTerminal(approvalCommand, host)
				}
			})
	}
}

/**
 * Called by the MCP tool handler with a tool result's text and the RESOLVED server connection; no-op unless the
 * server is trusted (isServerTrusted) and the text is an APPROVAL_REQUIRED refusal.
 */
export function notifyApprovalRequired(resultText: string, server: ServerConnectionView | undefined): void {
	try {
		const result = parseApprovalRequired(resultText, server)
		if (result && prompter) {
			prompter(result)
		}
	} catch (error) {
		console.error("[approvalTerminal] prompt failed:", error)
	}
}
