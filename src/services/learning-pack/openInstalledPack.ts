import { type CourseProgress, loadProgress as loadCourseProgress } from "@/services/htmlPreview/courseProgressStore"
import { learningPackProgressKey, resolveActiveLearningPackEntry, resolveActiveLearningPackLaunch } from "./runtimeIntegration"

/** Where an installed pack opens: the module recorded in the existing course-progress store, else the authored entry. */
export async function resolveResumeLaunch(
	root: string,
	packId: string,
	loadProgress: (progressKey: string) => Promise<Pick<CourseProgress, "currentModuleId">> = loadCourseProgress,
) {
	const entry = await resolveActiveLearningPackEntry(root, packId)
	const progress = await loadProgress(learningPackProgressKey(entry.scope))
	return resolveActiveLearningPackLaunch(root, packId, progress.currentModuleId)
}

export interface InstalledPackChoice {
	readonly packId: string
	readonly version: string
	readonly edition: string
}

export interface OpenInstalledPackDeps {
	/** Installed packs from the existing registry. */
	listInstalled(): Promise<readonly InstalledPackChoice[]>
	/** Choose one pack; undefined when the user dismisses the picker. */
	pick(choices: readonly InstalledPackChoice[]): Promise<string | undefined>
	/** Open the pack at its persisted module in the existing Studio panel. */
	open(packId: string): Promise<void>
	/** Tell the user nothing is installed; true when they chose to install. */
	offerInstall(): Promise<boolean>
	/** Run the existing install command. */
	install(): PromiseLike<unknown>
}

export type OpenInstalledPackResult =
	| { readonly status: "opened"; readonly packId: string }
	| { readonly status: "cancelled" }
	| { readonly status: "none-installed"; readonly installOffered: boolean }

/**
 * Open an already-installed Learning Pack without reinstalling it: zero installed packs explains and offers Install,
 * one opens directly, several ask which. `packId` (test mode only, supplied by the caller) skips the picker.
 */
export async function runOpenInstalledPack(deps: OpenInstalledPackDeps, packId?: string): Promise<OpenInstalledPackResult> {
	const installed = await deps.listInstalled()
	if (installed.length === 0) {
		const wantsInstall = await deps.offerInstall()
		if (wantsInstall) await deps.install()
		return { status: "none-installed", installOffered: wantsInstall }
	}
	let chosen = packId
	if (chosen === undefined) chosen = installed.length === 1 ? installed[0].packId : await deps.pick(installed)
	if (!chosen) return { status: "cancelled" }
	await deps.open(chosen)
	return { status: "opened", packId: chosen }
}
