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
import { type ApprovalRequired, parseApprovalRequired } from "@shared/aihydro/claimApproval"

export interface TerminalLike {
	show(): void
	sendText(text: string, addNewLine?: boolean): void
}

export interface ApprovalWindow {
	createTerminal(options: { name: string }): TerminalLike
	showWarningMessage(message: string, ...items: string[]): PromiseLike<string | undefined>
}

export const APPROVE_IN_TERMINAL = "Approve in terminal"

/** A command containing any control character (notably CR/LF) could auto-execute when typed. */
export function isSafeApprovalCommand(command: string): boolean {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
	return command.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(command)
}

/** Open a terminal and type (not run) the approval command. Returns false when refused as unsafe. */
export function openApprovalTerminal(command: string, host: Pick<ApprovalWindow, "createTerminal">): boolean {
	if (!isSafeApprovalCommand(command)) {
		return false
	}
	const terminal = host.createTerminal({ name: "AI-Hydro approval" })
	terminal.show()
	terminal.sendText(command, false)
	return true
}

export type ApprovalPrompter = (approval: ApprovalRequired) => void

let prompter: ApprovalPrompter | undefined

export function setApprovalPrompter(next: ApprovalPrompter | undefined): void {
	prompter = next
}

/** Prompter that offers the action as a notification; the user must click, then press Enter in the terminal. */
export function createApprovalPrompter(host: ApprovalWindow): ApprovalPrompter {
	return (approval) => {
		if (!isSafeApprovalCommand(approval.approvalCommand)) {
			void host.showWarningMessage("AI-Hydro: approval is required, but the suggested command was not safe to pre-fill.")
			return
		}
		void host
			.showWarningMessage(
				`Claim promotion needs your approval. This opens a terminal with \`${approval.approvalCommand}\` typed but not run; review it and press Enter yourself.`,
				APPROVE_IN_TERMINAL,
			)
			.then((choice) => {
				if (choice === APPROVE_IN_TERMINAL) {
					openApprovalTerminal(approval.approvalCommand, host)
				}
			})
	}
}

/** Called by the MCP tool handler with a tool result's text; no-op unless it is an APPROVAL_REQUIRED refusal. */
export function notifyApprovalRequired(resultText: string): void {
	try {
		const approval = parseApprovalRequired(resultText)
		if (approval && prompter) {
			prompter(approval)
		}
	} catch (error) {
		console.error("[approvalTerminal] prompt failed:", error)
	}
}
