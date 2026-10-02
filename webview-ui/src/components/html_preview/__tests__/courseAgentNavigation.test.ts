import { describe, expect, it, vi } from "vitest"
import { courseNavigationKey, persistThenLoadCourseModule, resolveAgentCourseNavigation } from "../courseAgentNavigation"
import type { CourseManifest, CourseModuleEntry } from "../useCourse"

const course: CourseManifest = {
	courseId: "course-1",
	title: "Synthetic course",
	modules: [
		{ id: "module-1", path: "01/module.html", title: "One" },
		{ id: "module-2", path: "02/module.html", title: "Two", prerequisites: ["module-1"] },
	],
}

describe("agent course navigation", () => {
	it("persists the destination before loading its visible module", async () => {
		const calls: string[] = []
		const loaded = await persistThenLoadCourseModule(
			"legacy:course-1",
			"module-2",
			"module-1",
			async (moduleId) => {
				calls.push(`persist:${moduleId}`)
				return { currentModuleId: moduleId }
			},
			async () => {
				calls.push("load")
			},
		)
		expect(loaded).toBe(true)
		expect(calls).toEqual(["persist:module-2", "load"])
	})

	it("does not load when persistence fails", async () => {
		const load = vi.fn()
		const loaded = await persistThenLoadCourseModule("legacy:course-1", "module-2", "module-1", async () => null, load)
		expect(loaded).toBe(false)
		expect(load).not.toHaveBeenCalled()
	})

	it("restores the prior module when visible loading fails", async () => {
		const persisted: (string | null)[] = []
		const failure = new Error("load failed")
		await expect(
			persistThenLoadCourseModule(
				"legacy:course-1",
				"module-2",
				"module-1",
				async (moduleId) => {
					persisted.push(moduleId)
					return { currentModuleId: moduleId }
				},
				async () => {
					throw failure
				},
			),
		).rejects.toBe(failure)
		expect(persisted).toEqual(["module-2", "module-1"])
	})

	it("serializes rapid destinations in request order", async () => {
		const calls: string[] = []
		let releaseFirst: (() => void) | undefined
		let signalFirstStarted: (() => void) | undefined
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve
		})
		const firstStarted = new Promise<void>((resolve) => {
			signalFirstStarted = resolve
		})
		const setCurrent = async (moduleId: string | null) => {
			calls.push(`persist:${moduleId}`)
			return { currentModuleId: moduleId }
		}
		const first = persistThenLoadCourseModule("legacy:course-1", "module-2", "module-1", setCurrent, async () => {
			calls.push("load:module-2")
			signalFirstStarted?.()
			await firstGate
		})
		await firstStarted
		const second = persistThenLoadCourseModule("legacy:course-1", "module-3", "module-2", setCurrent, async () => {
			calls.push("load:module-3")
		})
		await Promise.resolve()
		expect(calls).toEqual(["persist:module-2", "load:module-2"])
		releaseFirst?.()
		await Promise.all([first, second])
		expect(calls).toEqual(["persist:module-2", "load:module-2", "persist:module-3", "load:module-3"])
	})

	it("restores the last loaded destination when a queued load fails", async () => {
		const persisted: (string | null)[] = []
		const setCurrent = async (moduleId: string | null) => {
			persisted.push(moduleId)
			return { currentModuleId: moduleId }
		}
		const first = persistThenLoadCourseModule("legacy:course-1", "module-2", "module-1", setCurrent, async () => undefined)
		const second = persistThenLoadCourseModule("legacy:course-1", "module-3", "module-1", setCurrent, async () => {
			throw new Error("module-3 failed")
		})

		await expect(first).resolves.toBe(true)
		await expect(second).rejects.toThrow("module-3 failed")
		expect(persisted).toEqual(["module-2", "module-3", "module-2"])
	})

	it("uses distinct navigation queues for student and instructor editions", () => {
		const student = courseNavigationKey("course-1", {
			packId: "pack-1",
			courseId: "course-1",
			edition: "student",
			moduleId: "module-1",
		})
		const instructor = courseNavigationKey("course-1", {
			packId: "pack-1",
			courseId: "course-1",
			edition: "instructor",
			moduleId: "module-1",
		})
		expect(student).not.toBe(instructor)
	})

	it("refuses wrong-course, unknown, and locked targets", () => {
		const canAccess = (module: CourseModuleEntry) => module.id !== "module-2"
		expect(resolveAgentCourseNavigation({ courseId: "other", moduleId: "module-1" }, course, canAccess)).toBeNull()
		expect(resolveAgentCourseNavigation({ courseId: "course-1", moduleId: "missing" }, course, canAccess)).toBeNull()
		expect(resolveAgentCourseNavigation({ courseId: "course-1", moduleId: "module-2" }, course, canAccess)).toBeNull()
	})

	it("returns a fresh accessible target for the existing loader path", () => {
		expect(resolveAgentCourseNavigation({ courseId: "course-1", moduleId: "module-2" }, course, () => true)?.path).toBe(
			"02/module.html",
		)
	})
})
