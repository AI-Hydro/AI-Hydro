/**
 * Which editor lightbulb actions AI-Hydro offers, and where. Free of the `vscode` runtime so it is unit-testable;
 * the provider in extension.ts builds the `CodeAction`s from this.
 *
 * The lightbulb is ambient: it appears on every line of every file the provider covers. AI-Hydro offers it where a
 * hydrologist writes analysis code (Python, R, notebooks), not on every file type, and drops the "Improve" rewrite
 * action, which says "code" to a researcher and offered to rewrite their analysis on any selection. The commands
 * stay reachable from the command palette, the editor context menu and the keybinding.
 */
export type CodeActionId = "add" | "explain" | "fix"

/** Languages the lightbulb is offered for. Notebook cells are `python` or `r` documents, so they are covered. */
export const CODE_ACTION_LANGUAGES = ["python", "r", "jupyter"] as const

/** Languages "Fix with AI-Hydro" is offered for, when the editor reports a diagnostic on the range. */
export const FIX_LANGUAGES = ["python", "r"] as const

/** The DocumentSelector for `registerCodeActionsProvider`. */
export const CODE_ACTION_SELECTOR = CODE_ACTION_LANGUAGES.map((language) => ({ language }))

/** The actions to offer for a document of `languageId`; `hasDiagnostics` is whether the range carries any. */
export function offeredCodeActions(languageId: string, hasDiagnostics: boolean): CodeActionId[] {
	if (!(CODE_ACTION_LANGUAGES as readonly string[]).includes(languageId)) {
		return []
	}
	const actions: CodeActionId[] = ["add", "explain"]
	if (hasDiagnostics && (FIX_LANGUAGES as readonly string[]).includes(languageId)) {
		actions.push("fix")
	}
	return actions
}
