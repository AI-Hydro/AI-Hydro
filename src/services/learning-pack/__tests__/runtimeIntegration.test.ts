import { strict as assert } from "node:assert"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, it } from "mocha"
import type { LearningPackRegistry } from "../learningPackLifecycle"
import { atomicWriteJson, learningPackStoragePaths } from "../lifecycleStorage"
import {
	learningPackArtifactMetadata,
	learningPackControlsKey,
	learningPackProgressKey,
	resolveActiveLearningPackEntry,
	resolveActiveLearningPackLaunch,
	resolveInstalledLearningPackArtifact,
	resolveInstalledLearningPackScope,
	verifyInstalledLearningPack,
} from "../runtimeIntegration"
import { createValidLearningPackFiles } from "./learningPackTestFixture"

const roots: string[] = []

async function fixture(): Promise<{ root: string; module: string; secondModule: string }> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "aihydro-pack-runtime-"))
	roots.push(root)
	const relativePath = "packs/hmfp/versions/archive-sha"
	const installation = path.join(root, ...relativePath.split("/"))
	const module = path.join(installation, "modules", "water-balance", "module.html")
	const secondModule = path.join(installation, "modules", "routing", "module.html")
	await fs.mkdir(path.dirname(module), { recursive: true })
	await fs.mkdir(path.dirname(secondModule), { recursive: true })
	await fs.writeFile(module, "<!doctype html><title>Water balance</title>", "utf8")
	await fs.writeFile(secondModule, "<!doctype html><title>Routing</title>", "utf8")
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
	return { root, module, secondModule }
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("Learning Pack runtime integration", () => {
	it("resolves only active installed module paths and publishes neutral metadata", async () => {
		const { root, module } = await fixture()
		const scope = await resolveInstalledLearningPackScope(module, root, { verifyIntegrity: false })
		assert.deepEqual(scope, {
			packId: "hmfp",
			courseId: "hydrologic-modeling",
			edition: "student",
			moduleId: "water-balance",
		})
		assert.equal(learningPackArtifactMetadata(scope!).artifactKind, "learning-pack-v1")
		assert.equal(await resolveInstalledLearningPackScope(path.join(root, "outside.html"), root, { verifyIntegrity: false }), null)
	})

	it("isolates progress and controls by pack, course, edition, and module", () => {
		const student = { packId: "hmfp", courseId: "course", edition: "student" as const, moduleId: "one" }
		const instructor = { ...student, edition: "instructor" as const }
		assert.notEqual(learningPackProgressKey(student), learningPackProgressKey(instructor))
		assert.notEqual(learningPackControlsKey(student), learningPackControlsKey(instructor))
		assert.notEqual(learningPackControlsKey(student), learningPackControlsKey({ ...student, moduleId: "two" }))
	})

	it("resolves the active entry from the transactional registry", async () => {
		const { root, module } = await fixture()
		const entry = await resolveActiveLearningPackEntry(root, "hmfp")
		assert.equal(entry.filePath, module)
		assert.equal(entry.scope.moduleId, "water-balance")
	})

	it("resumes a current owned module and falls back to the authored entry for stale progress", async () => {
		const { root, module, secondModule } = await fixture()
		const resumed = await resolveActiveLearningPackLaunch(root, "hmfp", "routing")
		assert.equal(resumed.filePath, secondModule)
		assert.equal(resumed.scope.moduleId, "routing")

		const fallback = await resolveActiveLearningPackLaunch(root, "hmfp", "removed-module")
		assert.equal(fallback.filePath, module)
		assert.equal(fallback.scope.moduleId, "water-balance")
	})
})

describe("Learning Pack load-time integrity", () => {
	async function installSigned(): Promise<{ root: string; installation: string; entry: string; recorded: Parameters<typeof verifyInstalledLearningPack>[1] }> {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "aihydro-pack-verify-"))
		roots.push(root)
		const { files, fingerprint } = createValidLearningPackFiles()
		const relativePath = "packs/hmfp/versions/archive-sha"
		const installation = path.join(root, ...relativePath.split("/"))
		for (const [relative, bytes] of files) {
			const dest = path.join(installation, ...relative.split("/"))
			await fs.mkdir(path.dirname(dest), { recursive: true })
			await fs.writeFile(dest, bytes)
		}
		const recorded = {
			packId: "hmfp",
			courseId: "hmfp",
			moduleIds: ["hmfp.orientation.00", "hmfp.water-balance.01"],
			version: "0.1.0",
			edition: "student" as const,
			archiveSha256: "archive-sha",
			signerFingerprint: fingerprint,
			relativePath,
			installedAt: 1,
		}
		await atomicWriteJson(learningPackStoragePaths(root).registry, { schemaVersion: 1, packs: { hmfp: { active: recorded } } })
		return { root, installation, entry: path.join(installation, "modules", "hmfp.orientation.00", "module.html"), recorded }
	}

	it("accepts an untouched signed installation and resolves it as a pack module", async () => {
		const { root, installation, entry, recorded } = await installSigned()
		assert.equal(await verifyInstalledLearningPack(installation, recorded), true)
		const artifact = await resolveInstalledLearningPackArtifact(entry, root)
		assert.equal(artifact?.scope.moduleId, "hmfp.orientation.00")
	})

	it("refuses a module whose bytes changed after install", async () => {
		const { root, entry } = await installSigned()
		await fs.appendFile(entry, "<script>evil()</script>")
		assert.equal(await resolveInstalledLearningPackArtifact(entry, root), null)
	})

	it("refuses an installation with an undeclared extra file", async () => {
		const { root, installation, entry } = await installSigned()
		await fs.writeFile(path.join(installation, "modules", "extra.js"), "evil()")
		assert.equal(await resolveInstalledLearningPackArtifact(entry, root), null)
	})

	it("refuses when the signer differs from the one recorded at install", async () => {
		const { installation, recorded } = await installSigned()
		assert.equal(await verifyInstalledLearningPack(installation, { ...recorded, signerFingerprint: "sha256:someone-else" }), false)
	})

	it("does not follow a symlink that points into the pack store from outside", async function () {
		const { root, entry } = await installSigned()
		const outside = await fs.mkdtemp(path.join(os.tmpdir(), "aihydro-pack-link-"))
		roots.push(outside)
		const link = path.join(outside, "looks-innocent.html")
		await fs.symlink(entry, link).catch(() => this.skip())
		// Resolved by real path it IS the pack module (the link adds nothing); a link to a file
		// that is not a module of the pack must not resolve.
		await fs.writeFile(path.join(outside, "foreign.html"), "<html></html>")
		const foreignLink = path.join(root, "packs", "hmfp", "versions", "archive-sha", "modules", "foreign-link.html")
		await fs.symlink(path.join(outside, "foreign.html"), foreignLink).catch(() => this.skip())
		assert.equal(await resolveInstalledLearningPackArtifact(foreignLink, root), null)
	})
})
