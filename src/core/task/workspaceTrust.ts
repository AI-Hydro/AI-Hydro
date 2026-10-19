/**
 * Workspace trust as the command classifier sees it. VS Code's Restricted Mode (`vscode.workspace.isTrusted`) is
 * registered at activation (src/extension.ts). Hosts that cannot report trust (standalone, CLI, tests) leave the
 * provider unset, and an unset provider means NOT trusted: fail closed.
 */
let provider: (() => boolean) | undefined

export function setWorkspaceTrustProvider(next: (() => boolean) | undefined): void {
	provider = next
}

export function isWorkspaceTrusted(): boolean {
	try {
		return provider?.() === true
	} catch {
		return false
	}
}
