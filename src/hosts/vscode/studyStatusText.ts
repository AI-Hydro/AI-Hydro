import type { StudyStatus } from "@core/controller/ui/studyStatus"

/** A study name is data: `$(icon)` in it would draw a codicon in the status bar. A backslash escapes it. */
export function escapeCodicons(text: string): string {
	return text.replace(/\$\(/g, "\\$(")
}

/** The status bar item for the chat's bound study. Free of the `vscode` runtime so it is unit-testable. */
export function studyStatusText(study: StudyStatus): { text: string; tooltip: string; accessibility: string } {
	const name = study.label || study.studyId
	return {
		text: `$(location) ${escapeCodicons(name)}`,
		tooltip: `This chat is bound to study ${name}. Click to show the chat.`,
		accessibility: `AI-Hydro study ${name}`,
	}
}
