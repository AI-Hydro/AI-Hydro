import type { StudyStatus } from "@core/controller/ui/studyStatus"

/** The status bar item for the chat's bound study. Free of the `vscode` runtime so it is unit-testable. */
export function studyStatusText(study: StudyStatus): { text: string; tooltip: string; accessibility: string } {
	const name = study.label || study.studyId
	return {
		text: `$(location) ${name}`,
		tooltip: `This chat is bound to study ${name}. Click to go to the chat.`,
		accessibility: `AI-Hydro study ${name}`,
	}
}
