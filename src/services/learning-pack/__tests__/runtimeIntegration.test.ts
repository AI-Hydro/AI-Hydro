import { strict as assert } from "node:assert"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, it } from "mocha"
import type { LearningPackRegistry } from "../learningPackLifecycle"
import { atomicWriteJson, learningPackStoragePaths } from "../lifecycleStorage"
import {
	osAliasSpelling,
	spelledRootStillResolves,
	learningPackArtifactMetadata,
	learningPackControlsKey,
	learningPackProgressKey,
	resolveActiveLearningPackEntry,
	resolveActiveLearningPackLaunch,
	checkInstalledLearningPack,
	isIgnoredOsJunk,
	resolveInstalledLearningPackArtifact,
	resolveInstalledLearningPackScope,
	resolveInstalledLearningPackStatus,
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
		assert.equal(
			await resolveInstalledLearningPackScope(path.join(root, "outside.html"), root, { verifyIntegrity: false }),
			null,
		)
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

describe("Learning Pack load-time integrity", function () {
	// Each check re-reads and re-verifies the whole pack (Ed25519), which is slow on a loaded machine.
	this.timeout(20_000)

	async function installSigned(): Promise<{
		root: string
		installation: string
		entry: string
		recorded: Parameters<typeof verifyInstalledLearningPack>[1]
	}> {
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
		await atomicWriteJson(learningPackStoragePaths(root).registry, {
			schemaVersion: 1,
			packs: { hmfp: { active: recorded } },
		})
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

	it("ignores OS junk files in the installation but still refuses any other undeclared file", async () => {
		const { root, installation, entry, recorded } = await installSigned()
		for (const junk of [".DS_Store", "Thumbs.db", "desktop.ini", "._module.html"]) {
			await fs.writeFile(path.join(installation, "modules", junk), "junk")
		}
		await fs.writeFile(path.join(installation, ".DS_Store"), "junk")
		assert.equal((await checkInstalledLearningPack(installation, recorded)).ok, true)
		assert.equal((await resolveInstalledLearningPackArtifact(entry, root))?.scope.moduleId, "hmfp.orientation.00")
		await fs.writeFile(path.join(installation, "modules", "helper.js"), "evil()")
		const failed = await checkInstalledLearningPack(installation, recorded)
		assert.equal(failed.ok, false)
		assert.match(failed.ok ? "" : failed.reason, /undeclared file modules\/helper\.js/)
	})

	it("lists exactly the ignored junk names", () => {
		for (const name of [".DS_Store", "a/b/Thumbs.db", "desktop.ini", "modules/._x", "._"])
			assert.equal(isIgnoredOsJunk(name), true, name)
		for (const name of ["modules/.DS_Store.js", "thumbs.db.exe", "module._html", "pack.json", "x/_dot"])
			assert.equal(isIgnoredOsJunk(name), false, name)
	})

	it("reports why a tampered pack module was demoted", async () => {
		const { root, entry } = await installSigned()
		await fs.appendFile(entry, "<script>evil()</script>")
		const status = await resolveInstalledLearningPackStatus(entry, root)
		assert.equal(status.kind, "failed")
		assert.match(
			status.kind === "failed" ? status.reason : "",
			/(SHA-256|Size) mismatch for modules\/hmfp\.orientation\.00\/module\.html/,
		)
		assert.equal((await resolveInstalledLearningPackStatus(path.join(root, "outside.html"), root)).kind, "none")
	})

	it("refuses when the signer differs from the one recorded at install", async () => {
		const { installation, recorded } = await installSigned()
		assert.equal(
			await verifyInstalledLearningPack(installation, { ...recorded, signerFingerprint: "sha256:someone-else" }),
			false,
		)
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

describe("OS alias spelling of the installation root", () => {
	afterEach(async () => {
		await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
	})

	it("maps only the OS-owned alias prefixes", () => {
		assert.equal(osAliasSpelling("/private/var/folders/x/pack"), "/var/folders/x/pack")
		assert.equal(osAliasSpelling("/private/tmp/pack"), "/tmp/pack")
		assert.equal(osAliasSpelling("/private/etc/pack"), "/etc/pack")
		assert.equal(osAliasSpelling("/private/variant/pack"), undefined)
		assert.equal(osAliasSpelling("/Users/u/.aihydro/packs/hmfp"), undefined)
		assert.equal(osAliasSpelling("/home/u/pack"), undefined)
	})

	it("stops resolving when the spelled root is retargeted or missing", async () => {
		const base = await fs.mkdtemp(path.join(os.tmpdir(), "aihydro-pack-retarget-"))
		roots.push(base)
		const a = path.join(base, "a")
		const b = path.join(base, "b")
		await fs.mkdir(a)
		await fs.mkdir(b)
		const link = path.join(base, "link")
		await fs.symlink(a, link)
		const realA = await fs.realpath(a)
		assert.equal(spelledRootStillResolves(link, realA), true)
		await fs.rm(link)
		await fs.symlink(b, link)
		assert.equal(spelledRootStillResolves(link, realA), false)
		assert.equal(spelledRootStillResolves(path.join(base, "missing"), realA), false)
	})

	it("does not follow a symlinked directory inside the pack to a different root", async () => {
		const base = await fs.mkdtemp(path.join(os.tmpdir(), "aihydro-pack-inner-"))
		roots.push(base)
		const pack = await fs.realpath(base)
		const outside = path.join(pack, "outside")
		await fs.mkdir(outside)
		await fs.symlink(outside, path.join(pack, "modules"))
		// A spelling that goes through the inner link resolves elsewhere than the pack root.
		assert.equal(spelledRootStillResolves(path.join(pack, "modules"), pack), false)
	})
})
