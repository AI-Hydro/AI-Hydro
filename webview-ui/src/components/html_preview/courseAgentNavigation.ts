import type { LearningPackScope } from "./installedPackCsp"
import type { CourseManifest, CourseModuleEntry } from "./useCourse"

export interface AgentCourseNavigationRequest {
	courseId?: string
	moduleId?: string
}

const navigationTails = new Map<string, Promise<void>>()
const navigationDestinations = new Map<string, string | null>()

export function courseNavigationKey(courseId: string, scope?: LearningPackScope | null): string {
	return scope ? `${scope.packId}:${scope.courseId}:${scope.edition}` : `legacy:${courseId}`
}

/**
 * Serialize navigation per progress namespace, persist before loading, and
 * restore the previous destination when the visible load fails.
 */
export async function persistThenLoadCourseModule(
	navigationKey: string,
	moduleId: string,
	previousModuleId: string | null,
	setCurrent: (moduleId: string | null) => Promise<unknown | null>,
	load: () => Promise<void>,
): Promise<boolean> {
	const previous = navigationTails.get(navigationKey) ?? Promise.resolve()
	const operation = previous.then(async () => {
		if (!navigationDestinations.has(navigationKey)) {
			navigationDestinations.set(navigationKey, previousModuleId)
		}
		const rollbackModuleId = navigationDestinations.get(navigationKey) ?? null
		const persisted = await setCurrent(moduleId)
		if (persisted === null) {
			return false
		}
		try {
			await load()
			navigationDestinations.set(navigationKey, moduleId)
			return true
		} catch (error) {
			const restored = await setCurrent(rollbackModuleId)
			if (restored === null) {
				throw new AggregateError([error], "Course module load failed and progress restoration failed")
			}
			throw error
		}
	})
	const tail = operation.then(
		() => undefined,
		() => undefined,
	)
	navigationTails.set(navigationKey, tail)
	try {
		return await operation
	} finally {
		if (navigationTails.get(navigationKey) === tail) {
			navigationTails.delete(navigationKey)
			navigationDestinations.delete(navigationKey)
		}
	}
}

/** Resolve an agent intent only when it targets this course and an accessible module. */
export function resolveAgentCourseNavigation(
	request: AgentCourseNavigationRequest,
	course: CourseManifest,
	canAccess: (module: CourseModuleEntry) => boolean,
): CourseModuleEntry | null {
	if (request.courseId && request.courseId !== course.courseId) return null
	const moduleId = request.moduleId?.trim() ?? ""
	if (!moduleId) return null
	const target = course.modules.find((module) => module.id === moduleId)
	if (!target || !canAccess(target)) return null
	return target
}
