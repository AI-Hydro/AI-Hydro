import { strict as assert } from "node:assert"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, it } from "mocha"
import type { LearningPackRegistry } from "../learningPackLifecycle"
import { atomicWriteJson, learningPackStoragePaths } from "../lifecycleStorage"
import {
	type InstalledPackChoice,
	type OpenInstalledPackDeps,
	resolveResumeLaunch,
	runOpenInstalledPack,
} from "../openInstalledPack"
import { learningPackProgressKey } from "../runtimeIntegration"

const roots: string[] = []

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

function harness(installed: InstalledPackChoice[], pickAnswer?: string) {
	const calls = { opened: [] as string[], picked: 0, offered: 0 }
	const deps: OpenInstalledPackDeps = {
		listInstalled: async () => installed,
		pick: async () => {
			calls.picked++
			return pickAnswer
		},
		open: async (packId) => {
			calls.opened.push(packId)
		},
		offerInstall: () => {
			calls.offered++
		},
	}
	return { deps, calls }
}

const hmfp: InstalledPackChoice = { packId: "hmfp", version: "1.0.0", edition: "student" }
const other: InstalledPackChoice = { packId: "other", version: "2.0.0", edition: "instructor" }

describe("Open installed Learning Pack command", () => {
	it("opens a single installed pack directly, with no picker and no install", async () => {
		const { deps, calls } = harness([hmfp])
		assert.deepEqual(await runOpenInstalledPack(deps), { status: "opened", packId: "hmfp" })
		assert.deepEqual(calls, { opened: ["hmfp"], picked: 0, offered: 0 })
	})

	it("shows a picker for several packs and opens the chosen one", async () => {
		const { deps, calls } = harness([hmfp, other], "other")
		assert.deepEqual(await runOpenInstalledPack(deps), { status: "opened", packId: "other" })
		assert.deepEqual(calls.opened, ["other"])
		assert.equal(calls.picked, 1)
	})

	it("opens nothing when the picker is dismissed", async () => {
		const { deps, calls } = harness([hmfp, other], undefined)
		assert.deepEqual(await runOpenInstalledPack(deps), { status: "cancelled" })
		assert.deepEqual(calls.opened, [])
	})

	it("with none installed, offers Install and returns without waiting for the notification", async () => {
		const { deps, calls } = harness([])
		assert.deepEqual(await runOpenInstalledPack(deps), { status: "none-installed" })
		assert.deepEqual(calls, { opened: [], picked: 0, offered: 1 })
	})

	it("is not held open by a notification that is never dismissed, so a second call still runs", async () => {
		let pending = 0
		const deps: OpenInstalledPackDeps = {
			listInstalled: async () => [],
			pick: async () => undefined,
			open: async () => {},
			// A toast that never resolves: nothing here may be awaited by the command.
			offerInstall: () => {
				pending++
				void new Promise(() => {})
			},
		}
		const first = await Promise.race([runOpenInstalledPack(deps), new Promise((r) => setTimeout(() => r("wedged"), 500))])
		assert.deepEqual(first, { status: "none-installed" })
		const second = await Promise.race([runOpenInstalledPack(deps), new Promise((r) => setTimeout(() => r("wedged"), 500))])
		assert.deepEqual(second, { status: "none-installed" })
		assert.equal(pending, 2)
	})

	it("honours an explicit pack id without asking", async () => {
		const { deps, calls } = harness([hmfp, other])
		assert.deepEqual(await runOpenInstalledPack(deps, "hmfp"), { status: "opened", packId: "hmfp" })
		assert.equal(calls.picked, 0)
	})
})

describe("Installed Learning Pack resume", () => {
	async function installedPack() {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "aihydro-open-installed-"))
		roots.push(root)
		const relativePath = "packs/hmfp/versions/archive-sha"
		const installation = path.join(root, ...relativePath.split("/"))
		const first = path.join(installation, "modules", "water-balance", "module.html")
		const second = path.join(installation, "modules", "routing", "module.html")
		for (const file of [first, second]) {
			await fs.mkdir(path.dirname(file), { recursive: true })
			await fs.writeFile(file, "<!doctype html>", "utf8")
		}
		await atomicWriteJson(path.join(installation, "pack.json"), { entryModuleId: "water-balance" })
		await atomicWriteJson(path.join(installation, "course.json"), {
			courseId: "hydrologic-modeling",
			title: "Hydrologic Modeling",
			modules: [
				{ id: "water-balance", title: "Water balance", path: "modules/water-balance/module.html" },
				{ id: "routing", title: "Routing", path: "modules/routing/module.html" },
			],
		})
		const registry: LearningPackRegistry = {
			schemaVersion: 1,
			packs: {
				hmfp: {
					active: {
						packId: "hmfp",
						courseId: "hydrologic-modeling",
						moduleIds: ["water-balance", "routing"],
						version: "1.0.0",
						edition: "student",
						archiveSha256: "archive-sha",
						signerFingerprint: "sha256:signer",
						relativePath,
						installedAt: 1,
					},
				},
			},
		}
		await atomicWriteJson(learningPackStoragePaths(root).registry, registry)
		return { root, first, second }
	}

	it("resumes at the module saved in the progress store, under the pack's own progress key", async () => {
		const { root, second } = await installedPack()
		const keys: string[] = []
		const launch = await resolveResumeLaunch(root, "hmfp", async (key) => {
			keys.push(key)
			return { currentModuleId: "routing" }
		})
		assert.equal(launch.filePath, second)
		assert.equal(launch.scope.moduleId, "routing")
		assert.deepEqual(keys, [learningPackProgressKey({ packId: "hmfp", courseId: "hydrologic-modeling", edition: "student" })])
	})

	it("refuses, rather than opening an empty panel, when the resumed module file is missing", async () => {
		const { root, second } = await installedPack()
		await fs.rm(second)
		await assert.rejects(
			resolveResumeLaunch(root, "hmfp", async () => ({ currentModuleId: "routing" })),
			/missing from the installed pack/,
		)
	})

	it("propagates that failure from the open command so the host can report it", async () => {
		const { root } = await installedPack()
		await fs.rm(path.join(root, "packs", "hmfp", "versions", "archive-sha", "modules", "routing"), { recursive: true })
		const deps: OpenInstalledPackDeps = {
			listInstalled: async () => [hmfp],
			pick: async () => undefined,
			open: async (packId) => {
				await resolveResumeLaunch(root, packId, async () => ({ currentModuleId: "routing" }))
			},
			offerInstall: () => {},
		}
		await assert.rejects(runOpenInstalledPack(deps), /missing from the installed pack/)
	})

	it("falls back to the authored entry when nothing, or a stale module, is saved", async () => {
		const { root, first } = await installedPack()
		assert.equal((await resolveResumeLaunch(root, "hmfp", async () => ({ currentModuleId: null }))).filePath, first)
		assert.equal((await resolveResumeLaunch(root, "hmfp", async () => ({ currentModuleId: "gone" }))).filePath, first)
	})
})
