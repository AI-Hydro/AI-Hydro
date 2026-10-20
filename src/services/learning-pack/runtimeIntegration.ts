import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { aihydroPath } from "@shared/aihydro/aihydroHome"
import { minVersion } from "semver"
import { type InstalledLearningPackVersion, loadLearningPackRegistry } from "./learningPackLifecycle"
import { learningPackStoragePaths } from "./lifecycleStorage"
import type { LearningPackCourse, LearningPackEdition } from "./types"
import { validateLearningPackFiles } from "./validateLearningPack"

export const LEARNING_PACK_ARTIFACT_KIND = "learning-pack-v1"

export interface InstalledLearningPackScope {
	readonly packId: string
	readonly courseId: string
	readonly edition: LearningPackEdition
	readonly moduleId: string
}

export interface InstalledLearningPackArtifact {
	readonly scope: InstalledLearningPackScope
	readonly installationRoot: string
}

export function parseInstalledLearningPackScope(value: unknown): InstalledLearningPackScope | null {
	if (!value || typeof value !== "object") return null
	const candidate = value as Record<string, unknown>
	if (
		typeof candidate.packId !== "string" ||
		typeof candidate.courseId !== "string" ||
		typeof candidate.moduleId !== "string" ||
		(candidate.edition !== "student" && candidate.edition !== "instructor")
	) {
		return null
	}
	return {
		packId: candidate.packId,
		courseId: candidate.courseId,
		edition: candidate.edition,
		moduleId: candidate.moduleId,
	}
}

export function defaultLearningPackRoot(): string {
	return process.env.AIHYDRO_LEARNING_PACK_ROOT || aihydroPath("learning-packs")
}

export function containedBy(candidate: string, parent: string): boolean {
	const relative = path.relative(parent, candidate)
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

async function listFiles(directory: string, base = directory): Promise<string[]> {
	const out: string[] = []
	for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
		const full = path.join(directory, entry.name)
		if (entry.isDirectory()) out.push(...(await listFiles(full, base)))
		else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"))
		else out.push(`${path.relative(base, full).split(path.sep).join("/")}\u0000non-regular`)
	}
	return out
}

/**
 * Re-verify an installed pack at load time, not only at install: every checksummed file
 * must still hash to its signed value, the Ed25519 signature must still verify, the
 * signer must be the one recorded at install, and no undeclared file may live in the
 * installation directory (an unlisted script would load unsigned code under a signed name).
 */
export async function verifyInstalledLearningPack(installation: string, recorded: InstalledLearningPackVersion): Promise<boolean> {
	try {
		const present = await listFiles(installation)
		const files = new Map<string, Uint8Array>()
		for (const relative of present) {
			if (relative.includes("\u0000")) return false
			files.set(relative, await fs.readFile(path.join(installation, ...relative.split("/"))))
		}
		const manifestBytes = files.get("pack.json")
		if (!manifestBytes) return false
		const range = (JSON.parse(Buffer.from(manifestBytes).toString("utf8")) as { compatibility?: { aiHydro?: string } }).compatibility
			?.aiHydro
		const version = range ? minVersion(range)?.version : undefined
		if (!version) return false
		const verified = validateLearningPackFiles(files, { aiHydroVersion: version })
		if (verified.status !== "valid" || !verified.verified) return false
		// validateLearningPackFiles also rejects any undeclared file in the directory.
		return verified.verified.signerFingerprint === recorded.signerFingerprint
	} catch {
		return false
	}
}

function activeRoot(root: string, active: InstalledLearningPackVersion): string {
	return path.resolve(learningPackStoragePaths(root).root, ...active.relativePath.split("/"))
}

async function realpathOr(candidate: string): Promise<string> {
	try {
		return await fs.realpath(candidate)
	} catch {
		return path.resolve(candidate)
	}
}

export async function resolveInstalledLearningPackArtifact(
	filePath: string,
	root = defaultLearningPackRoot(),
	options: { verifyIntegrity?: boolean } = {},
): Promise<InstalledLearningPackArtifact | null> {
	// Symlink-safe: compare real paths so a link placed inside (or pointing into) the
	// pack store cannot make a foreign file look like a pack module.
	const resolvedFile = await realpathOr(filePath)
	let registry
	try {
		registry = await loadLearningPackRegistry(root)
	} catch {
		return null
	}
	for (const [packId, record] of Object.entries(registry.packs)) {
		const installation = await realpathOr(activeRoot(root, record.active))
		if (!containedBy(resolvedFile, installation)) continue
		try {
			// Trust decisions always verify; only unit fixtures with synthetic installs opt out.
			if (options.verifyIntegrity !== false && !(await verifyInstalledLearningPack(installation, record.active))) return null
			const course = JSON.parse(await fs.readFile(path.join(installation, "course.json"), "utf8")) as LearningPackCourse
			const module = course.modules.find((entry) => path.resolve(installation, ...entry.path.split("/")) === resolvedFile)
			if (!module) return null
			return Object.freeze({
				installationRoot: installation,
				scope: Object.freeze({
					packId,
					courseId: record.active.courseId,
					edition: record.active.edition,
					moduleId: module.id,
				}),
			})
		} catch {
			return null
		}
	}
	return null
}

export async function resolveInstalledLearningPackScope(
	filePath: string,
	root = defaultLearningPackRoot(),
	options: { verifyIntegrity?: boolean } = {},
): Promise<InstalledLearningPackScope | null> {
	return (await resolveInstalledLearningPackArtifact(filePath, root, options))?.scope ?? null
}

export function learningPackArtifactMetadata(scope: InstalledLearningPackScope): Readonly<Record<string, string>> {
	return Object.freeze({
		artifactKind: LEARNING_PACK_ARTIFACT_KIND,
		learningPackId: scope.packId,
		learningPackCourseId: scope.courseId,
		learningPackEdition: scope.edition,
		learningPackModuleId: scope.moduleId,
	})
}

function scopedKey(kind: "progress" | "controls", values: readonly string[]): string {
	const digest = createHash("sha256")
		.update(JSON.stringify([kind, ...values]), "utf8")
		.digest("hex")
	return `learning-pack-v1-${kind}-${digest}`
}

export function learningPackProgressKey(scope: Pick<InstalledLearningPackScope, "packId" | "courseId" | "edition">): string {
	return scopedKey("progress", [scope.packId, scope.courseId, scope.edition])
}

export function learningPackControlsKey(scope: InstalledLearningPackScope): string {
	return scopedKey("controls", [scope.packId, scope.courseId, scope.edition, scope.moduleId])
}

export async function resolveActiveLearningPackEntry(
	root: string,
	packId: string,
): Promise<{ readonly filePath: string; readonly title: string; readonly scope: InstalledLearningPackScope }> {
	return resolveActiveLearningPackLaunch(root, packId)
}

export async function resolveActiveLearningPackLaunch(
	root: string,
	packId: string,
	preferredModuleId?: string | null,
): Promise<{ readonly filePath: string; readonly title: string; readonly scope: InstalledLearningPackScope }> {
	const record = (await loadLearningPackRegistry(root)).packs[packId]
	if (!record) throw new Error(`Pack ${packId} is not installed`)
	const installation = activeRoot(root, record.active)
	const manifest = JSON.parse(await fs.readFile(path.join(installation, "pack.json"), "utf8")) as {
		entryModuleId: string
	}
	const course = JSON.parse(await fs.readFile(path.join(installation, "course.json"), "utf8")) as LearningPackCourse
	const module =
		course.modules.find((entry) => entry.id === preferredModuleId) ??
		course.modules.find((entry) => entry.id === manifest.entryModuleId)
	if (!module) throw new Error(`Pack ${packId} entry module is missing from course.json`)
	return Object.freeze({
		filePath: path.resolve(installation, ...module.path.split("/")),
		title: module.title,
		scope: Object.freeze({
			packId,
			courseId: record.active.courseId,
			edition: record.active.edition,
			moduleId: module.id,
		}),
	})
}
