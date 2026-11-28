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

function harness(installed: InstalledPackChoice[], pickAnswer?: string, installOffer = false) {
	const calls = { opened: [] as string[], picked: 0, offered: 0, installed: 0 }
	const deps: OpenInstalledPackDeps = {
		listInstalled: async () => installed,
		pick: async () => {
			calls.picked++
			return pickAnswer
		},
		open: async (packId) => {
			calls.opened.push(packId)
		},
		offerInstall: async () => {
			calls.offered++
			return installOffer
		},
		install: async () => {
			calls.installed++
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
		assert.deepEqual(calls, { opened: ["hmfp"], picked: 0, offered: 0, installed: 0 })
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

	it("with none installed, says so and offers Install, running it only when accepted", async () => {
		const declined = harness([], undefined, false)
		assert.deepEqual(await runOpenInstalledPack(declined.deps), { status: "none-installed", installOffered: false })
		assert.deepEqual(declined.calls, { opened: [], picked: 0, offered: 1, installed: 0 })

		const accepted = harness([], undefined, true)
		assert.deepEqual(await runOpenInstalledPack(accepted.deps), { status: "none-installed", installOffered: true })
		assert.deepEqual(accepted.calls, { opened: [], picked: 0, offered: 1, installed: 1 })
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

	it("falls back to the authored entry when nothing, or a stale module, is saved", async () => {
		const { root, first } = await installedPack()
		assert.equal((await resolveResumeLaunch(root, "hmfp", async () => ({ currentModuleId: null }))).filePath, first)
		assert.equal((await resolveResumeLaunch(root, "hmfp", async () => ({ currentModuleId: "gone" }))).filePath, first)
	})
})
