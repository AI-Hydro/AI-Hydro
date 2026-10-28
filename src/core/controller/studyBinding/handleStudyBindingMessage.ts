import type { Controller } from "@core/controller"

/**
 * The chip/picker's messages. Only three things can happen, and none binds without the user's explicit choice of
 * a study the host itself offered (`chooseStudy` rejects any other id):
 *   open     list the studies and show the picker;
 *   choose   bind the chosen study;
 *   decline  close the picker ("No study" or "New study"), binding nothing.
 */
export async function handleStudyBindingMessage(
	controller: Controller,
	payload: Record<string, unknown> | undefined,
): Promise<void> {
	const action = payload?.action
	if (action === "open") {
		await controller.openStudyPicker()
	} else if (action === "choose" && typeof payload?.studyId === "string") {
		await controller.chooseStudy(payload.studyId)
	} else if (action === "decline") {
		controller.declineStudyChoice(payload?.kind === "new" ? "new" : "none")
	}
}
