/**
 * Assemble an UNSIGNED, deterministic Learning Pack archive from already-loaded course sources.
 *
 * Pure and in-memory: no filesystem, no keys, no clock. Everything non-deterministic (commit, timestamp, the
 * publisher's public key) is an explicit input, so the same inputs always give the same archive bytes.
 *
 * Nothing here is trusted to decide validity. Before returning, the assembled pack is signed with a throwaway
 * in-memory key and run through the extension's own verifier (`inspectLearningPackArchiveBytes`); anything the
 * verifier rejects aborts the build, so the builder and the verifier cannot drift apart.
 */

import { generateKeyPairSync, sign } from "node:crypto"
import { applyEdits, modify } from "jsonc-parser"
import { minVersion } from "semver"
import { canonicalJsonBytes, parseStrictJsonSource } from "../canonicalJson"
import { inspectLearningPackArchiveBytes } from "../inspectLearningPackArchive"
import type { LearningPackDiagnostic, LearningPackManifest } from "../types"
import {
	buildChecksums,
	CHECKSUMS_PATH,
	compareContractPaths,
	SIGNATURE_PATH,
	signatureDocument,
	spkiFingerprint,
	writeStoredZip,
} from "./contractPrimitives"
import { CONTRACT_ID_PATTERN, type PackConfig } from "./packConfig"

export const BUILDER_VERSION = 1
/** Valid-looking placeholder key ID for development builds made without `--publisher-pub`; `sign --ephemeral` replaces it. */
export const PLACEHOLDER_KEY_ID = `sha256:${"0".repeat(64)}`

export class PackBuildError extends Error {
	constructor(
		message: string,
		readonly diagnostics: readonly LearningPackDiagnostic[] = [],
	) {
		super(message)
		this.name = "PackBuildError"
	}
}

export interface SourceBundle {
	/** Parsed source `course.json`. */
	course: unknown
	/** Module HTML bytes keyed by the SOURCE module ID. */
	modules: ReadonlyMap<string, Uint8Array>
	/** Extra file bytes keyed by their pack path (already confined to assets/datasets/citations/environments). */
	extraFiles: ReadonlyMap<string, Uint8Array>
}

export type BuildKind = "release" | "development"

export interface BuildPackInput {
	config: PackConfig
	sources: SourceBundle
	buildKind: BuildKind
	/** SPKI DER of the publisher's public key. Required for a release build. */
	publisherSpkiDer?: Uint8Array
	provenance: { sourceCommit: string; sourceDirty: boolean; generatedAt: string }
}

export type PackTransform =
	| { type: "course-id-rewrite"; from: string; to: string }
	| { type: "module-id-rewrite"; path: string; from: string; to: string }
	| { type: "course-manifest-allowlist"; droppedCourseKeys: string[]; droppedModuleKeys: string[] }

export interface BuiltPack {
	/** All archive entries of the unsigned pack, including `checksums.json`. */
	readonly files: ReadonlyMap<string, Buffer>
	readonly archive: Buffer
	readonly keyId: string
	readonly manifest: LearningPackManifest
	readonly transforms: readonly PackTransform[]
}

/** Files the builder writes itself; an extra file may not take their place. */
const GENERATED_PATHS = new Set(["pack.json", "course.json", "environments/environment.json", "provenance/provenance.json"])

const MODULE_BLOCK = /<script\s+type=["']application\/vnd\.aihydro\.module\+json["'][^>]*>([\s\S]*?)<\/script>/gi

/** Course-level source keys carried into the pack. `trustLevel` is deliberately absent: content cannot grant itself trust. */
const COURSE_KEYS = [
	"title",
	"authors",
	"abstract",
	"topic",
	"version",
	"license",
	"kernel",
	"estimatedHours",
	"citation",
	"citationUrl",
	"authorUrl",
] as const
/** Module-level source keys carried into the pack. `downloadUrl` is absent: a pack is a local archive. */
const MODULE_KEYS = ["title", "abstract", "estimatedMinutes", "prerequisites"] as const

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}

interface ModuleManifestBlock {
	start: number
	end: number
	text: string
	manifest: Record<string, unknown>
}

function findModuleManifest(html: string, label: string): ModuleManifestBlock {
	const matches = [...html.matchAll(MODULE_BLOCK)]
	if (matches.length !== 1) {
		throw new PackBuildError(
			matches.length === 0
				? `${label} has no vnd.aihydro.module+json manifest block`
				: `${label} has ${matches.length} vnd.aihydro.module+json manifest blocks; exactly one is allowed`,
		)
	}
	const [match] = matches
	const text = match[1]
	const start = (match.index ?? 0) + match[0].indexOf(text)
	let manifest: unknown
	try {
		manifest = parseStrictJsonSource(Buffer.from(text, "utf8"), `${label} manifest block`)
	} catch (error) {
		throw new PackBuildError(error instanceof Error ? error.message : String(error))
	}
	if (!isRecord(manifest)) throw new PackBuildError(`${label} manifest block must be a JSON object`)
	return { start, end: start + text.length, text, manifest }
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
	} catch {
		throw new PackBuildError(`${label} is not valid UTF-8`)
	}
}

/**
 * Rewrite only the module `id` inside the `vnd.aihydro.module+json` block. Every other byte of the document
 * (including the rest of the block and its formatting) is kept; the result is re-parsed to prove that only
 * the id changed.
 */
export function rewriteModuleManifestId(htmlBytes: Uint8Array, newId: string, label: string): Buffer {
	const html = decodeUtf8(htmlBytes, label)
	const block = findModuleManifest(html, label)
	const edits = modify(block.text, ["id"], newId, { formattingOptions: { insertSpaces: true, tabSize: 2 } })
	const rewritten = applyEdits(block.text, edits)
	const result = `${html.slice(0, block.start)}${rewritten}${html.slice(block.end)}`
	const check = findModuleManifest(result, label)
	const expected = { ...block.manifest, id: newId }
	if (JSON.stringify(sortKeys(check.manifest)) !== JSON.stringify(sortKeys(expected))) {
		throw new PackBuildError(`${label}: rewriting the module id changed more than the id`)
	}
	if (result.slice(0, block.start) !== html.slice(0, block.start) || result.slice(check.end) !== html.slice(block.end)) {
		throw new PackBuildError(`${label}: rewriting the module id changed bytes outside the manifest block`)
	}
	return Buffer.from(result, "utf8")
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys)
	if (isRecord(value)) {
		return Object.fromEntries(
			Object.keys(value)
				.sort(compareContractPaths)
				.map((key) => [key, sortKeys(value[key])]),
		)
	}
	return value
}

function makeIdMapper(config: PackConfig, sourceIds: readonly string[]): (sourceId: string) => string {
	for (const key of Object.keys(config.idMap)) {
		if (!sourceIds.includes(key)) {
			throw new PackBuildError(`idMap key "${key}" is not the course ID or a module ID in the source course.json`)
		}
	}
	const mapped = new Map<string, string>()
	for (const id of sourceIds) {
		const target = config.idMap[id] ?? `${config.idPrefix ?? ""}${id}`
		if (!CONTRACT_ID_PATTERN.test(target)) {
			throw new PackBuildError(`Pack ID "${target}" (from "${id}") does not match the contract ID pattern`)
		}
		mapped.set(id, target)
	}
	const seen = new Map<string, string>()
	for (const [source, target] of mapped) {
		const clash = seen.get(target)
		if (clash !== undefined) throw new PackBuildError(`"${clash}" and "${source}" both map to pack ID "${target}"`)
		seen.set(target, source)
	}
	return (sourceId) => {
		const target = mapped.get(sourceId)
		if (target === undefined) throw new PackBuildError(`"${sourceId}" is not an ID in the source course.json`)
		return target
	}
}

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const key of keys) if (source[key] !== undefined) out[key] = source[key]
	return out
}

function dropped(source: Record<string, unknown>, kept: readonly string[], extra: readonly string[]): string[] {
	return Object.keys(source)
		.filter((key) => !kept.includes(key) && !extra.includes(key))
		.sort(compareContractPaths)
}

function generatedAtValid(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) && !Number.isNaN(Date.parse(value))
}

/** Assemble the unsigned pack. Throws PackBuildError before returning anything if the result would not verify. */
export async function assembleUnsignedPack(input: BuildPackInput): Promise<BuiltPack> {
	const { config, sources, buildKind } = input
	if (buildKind === "release" && !input.publisherSpkiDer) {
		throw new PackBuildError("A release build needs the publisher's public key (--publisher-pub)")
	}
	if (!/^[0-9a-f]{40}$/.test(input.provenance.sourceCommit)) {
		throw new PackBuildError("Provenance sourceCommit must be a full lowercase Git SHA")
	}
	if (!generatedAtValid(input.provenance.generatedAt)) {
		throw new PackBuildError("Provenance generatedAt must be an ISO-8601 UTC timestamp")
	}

	const course = sources.course
	if (!isRecord(course) || typeof course.courseId !== "string" || !Array.isArray(course.modules)) {
		throw new PackBuildError("Source course.json must be an object with a courseId and a modules array")
	}
	const sourceModules: Record<string, unknown>[] = []
	for (const entry of course.modules) {
		if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.title !== "string") {
			throw new PackBuildError("Every source course.json module needs a string id and title")
		}
		sourceModules.push(entry)
	}
	if (sourceModules.length === 0) throw new PackBuildError("Source course.json lists no modules")
	const sourceModuleIds = sourceModules.map((entry) => entry.id as string)
	if (new Set(sourceModuleIds).size !== sourceModuleIds.length)
		throw new PackBuildError("Source course.json repeats a module ID")
	const sourceCourseId = course.courseId
	if (sourceModuleIds.includes(sourceCourseId)) {
		// The contract allows it, but an idMap cannot tell the two apart; refuse rather than guess.
		throw new PackBuildError(`Course ID "${sourceCourseId}" is also a module ID; rename one in the source`)
	}
	const mapId = makeIdMapper(config, [sourceCourseId, ...sourceModuleIds])

	const transforms: PackTransform[] = []
	const courseId = mapId(sourceCourseId)
	if (courseId !== sourceCourseId) transforms.push({ type: "course-id-rewrite", from: sourceCourseId, to: courseId })

	const payload = new Map<string, Uint8Array>()
	const droppedModuleKeys = new Set<string>()
	const courseModules: Record<string, unknown>[] = []
	for (const entry of sourceModules) {
		const sourceId = entry.id as string
		const html = sources.modules.get(sourceId)
		if (!html) throw new PackBuildError(`No module source was loaded for "${sourceId}"`)
		const label = `module ${sourceId}`
		const manifest = findModuleManifest(decodeUtf8(html, label), label).manifest
		if (manifest.id !== sourceId) {
			throw new PackBuildError(
				`${label}: its manifest id is ${JSON.stringify(manifest.id)} but course.json lists it as "${sourceId}"`,
			)
		}
		const requires = isRecord(manifest.requires) ? manifest.requires : {}
		if (config.localPython === "none" && requires.executable === true) {
			throw new PackBuildError(`${label} requires execution but localPython is "none"; declare terminal-equivalent`)
		}
		const packId = mapId(sourceId)
		const path = `modules/${packId}/module.html`
		if (packId !== sourceId) {
			payload.set(path, rewriteModuleManifestId(html, packId, label))
			transforms.push({ type: "module-id-rewrite", path, from: sourceId, to: packId })
		} else {
			payload.set(path, Buffer.from(html))
		}
		for (const key of dropped(entry, MODULE_KEYS, ["id", "path"])) droppedModuleKeys.add(key)
		const prerequisites = Array.isArray(entry.prerequisites)
			? entry.prerequisites.map((id) => {
					if (typeof id !== "string") throw new PackBuildError(`${label}: prerequisites must be module IDs`)
					return mapId(id)
				})
			: undefined
		courseModules.push({
			...pick(entry, MODULE_KEYS),
			id: packId,
			path,
			...(prerequisites ? { prerequisites } : {}),
		})
	}
	const droppedCourseKeys = dropped(course, COURSE_KEYS, ["courseId", "modules"])
	if (droppedCourseKeys.length > 0 || droppedModuleKeys.size > 0) {
		transforms.push({
			type: "course-manifest-allowlist",
			droppedCourseKeys,
			droppedModuleKeys: [...droppedModuleKeys].sort(compareContractPaths),
		})
	}

	const title = config.title ?? (typeof course.title === "string" ? course.title : undefined)
	const license = config.license ?? (typeof course.license === "string" ? course.license : undefined)
	if (!title) throw new PackBuildError("No title: set `title` in pack.config.json or in the source course.json")
	if (!license) throw new PackBuildError("No license: set `license` in pack.config.json or in the source course.json")
	const sourceEntry = config.entryModule ?? sourceModuleIds[0]
	if (!sourceModuleIds.includes(sourceEntry))
		throw new PackBuildError(`entryModule "${sourceEntry}" is not a module in course.json`)

	const keyId = input.publisherSpkiDer ? spkiFingerprint(input.publisherSpkiDer) : PLACEHOLDER_KEY_ID
	const manifest: LearningPackManifest = {
		schemaVersion: 1,
		packId: config.packId,
		version: config.version,
		edition: config.edition,
		title,
		license,
		publisher: { name: config.publisher.name, keyId },
		ownership: { courseId, moduleIds: courseModules.map((entry) => entry.id as string) },
		entryModuleId: mapId(sourceEntry),
		compatibility: { aiHydro: config.aiHydroRange, packApi: 1, runtimeContract: "html-preview-v1" },
		capabilities: { localPython: config.localPython, webExternalOrigins: [] },
		environmentPath: "environments/environment.json",
		provenancePath: "provenance/provenance.json",
	}
	const courseManifest = { ...pick(course, COURSE_KEYS), courseId, title, license, modules: courseModules }

	for (const [path, bytes] of sources.extraFiles) {
		if (payload.has(path) || GENERATED_PATHS.has(path))
			throw new PackBuildError(`Extra file ${path} collides with a generated file`)
		payload.set(path, bytes)
	}
	payload.set("course.json", canonicalJsonBytes(courseManifest))
	payload.set(
		"environments/environment.json",
		canonicalJsonBytes({
			python: config.environment.python,
			requiredImports: config.environment.requiredImports,
			runtimeRisk: config.localPython,
		}),
	)
	payload.set(
		"provenance/provenance.json",
		canonicalJsonBytes({
			buildKind,
			builderVersion: BUILDER_VERSION,
			generatedAt: input.provenance.generatedAt,
			sourceCommit: input.provenance.sourceCommit,
			sourceDirty: input.provenance.sourceDirty,
			sourceCourseId,
			transforms: sortTransforms(transforms),
		}),
	)
	payload.set("pack.json", canonicalJsonBytes(manifest))

	await verifyBeforeWrite(payload, manifest)

	const checksums = buildChecksums(payload)
	const files = new Map<string, Buffer>()
	for (const [path, bytes] of payload) files.set(path, Buffer.from(bytes))
	files.set(CHECKSUMS_PATH, checksums.bytes)
	return { files, archive: writeStoredZip(files), keyId, manifest, transforms: sortTransforms(transforms) }
}

function sortTransforms(transforms: readonly PackTransform[]): PackTransform[] {
	const key = (transform: PackTransform): string =>
		transform.type === "module-id-rewrite" ? `${transform.type}\0${transform.path}` : transform.type
	return [...transforms].sort((a, b) => compareContractPaths(key(a), key(b)))
}

/**
 * Run the real verifier over this payload signed with a throwaway key whose fingerprint stands in for the
 * publisher's. The only bytes that differ from the real pack are the signed `keyId`, so any other defect
 * (schema, ownership, paths, limits, module manifests, ranges) is caught before anything is written.
 */
async function verifyBeforeWrite(payload: ReadonlyMap<string, Uint8Array>, manifest: LearningPackManifest): Promise<void> {
	const range = minVersion(manifest.compatibility.aiHydro)
	if (!range) throw new PackBuildError(`aiHydroRange "${manifest.compatibility.aiHydro}" matches no version`)
	const { privateKey, publicKey } = generateKeyPairSync("ed25519")
	const der = publicKey.export({ format: "der", type: "spki" })
	const trial = new Map(payload)
	trial.set("pack.json", canonicalJsonBytes({ ...manifest, publisher: { ...manifest.publisher, keyId: spkiFingerprint(der) } }))
	const checksums = buildChecksums(trial)
	trial.set(CHECKSUMS_PATH, checksums.bytes)
	trial.set(SIGNATURE_PATH, signatureDocument(der, sign(null, checksums.bytes, privateKey)))
	const result = await inspectLearningPackArchiveBytes(writeStoredZip(trial), { aiHydroVersion: range.version })
	if (result.status !== "valid") {
		const detail = result.diagnostics.map((d) => `${d.code}: ${d.message}${d.path ? ` (${d.path})` : ""}`).join("; ")
		throw new PackBuildError(`The verifier rejects this pack: ${detail}`, result.diagnostics)
	}
}
