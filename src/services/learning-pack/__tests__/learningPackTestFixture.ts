import { createPublicKey, generateKeyPairSync, type KeyObject, sign } from "node:crypto"
import { buildChecksums, signatureDocument, spkiFingerprint, writeStoredZip } from "../authoring/contractPrimitives"
import { canonicalJsonBytes } from "../canonicalJson"
import type { LearningPackManifest } from "../types"

export const TEST_MODULE_IDS = ["hmfp.orientation.00", "hmfp.water-balance.01"]

function moduleHtml(id: string, executable: boolean): Buffer {
	return Buffer.from(
		`<!doctype html><html><head><script type="application/vnd.aihydro.module+json">${JSON.stringify({
			id,
			title: id,
			version: "0.1.0",
			authors: [{ name: "Synthetic Test" }],
			license: "CC-BY-4.0",
			requires: { executable, python: executable ? ["matplotlib"] : [] },
		})}</script></head><body>${id}</body></html>`,
		"utf8",
	)
}

export function createValidLearningPackFiles(options?: {
	firstModuleBytes?: Uint8Array
	secondModuleBytes?: Uint8Array
	version?: string
	edition?: "student" | "instructor"
	packId?: string
	courseId?: string
	privateKey?: KeyObject
	provenanceBytes?: Uint8Array
	/** SemVer range the pack declares; defaults to the 0.2.x line the unit tests pin their runtime to. */
	aiHydroRange?: string
}): {
	files: Map<string, Uint8Array>
	fingerprint: string
} {
	const generated = options?.privateKey ? undefined : generateKeyPairSync("ed25519")
	const privateKey = options?.privateKey ?? generated!.privateKey
	const publicKey = options?.privateKey ? createPublicKey(options.privateKey) : generated!.publicKey
	const publicKeyDer = publicKey.export({ format: "der", type: "spki" })
	const fingerprint = spkiFingerprint(publicKeyDer)
	const manifest: LearningPackManifest = {
		schemaVersion: 1,
		packId: options?.packId ?? "hmfp",
		version: options?.version ?? "0.1.0",
		edition: options?.edition ?? "student",
		title: "Hydrologic Modeling from First Principles",
		license: "CC-BY-4.0",
		publisher: { name: "Synthetic Test", keyId: fingerprint },
		ownership: { courseId: options?.courseId ?? "hmfp", moduleIds: TEST_MODULE_IDS },
		entryModuleId: TEST_MODULE_IDS[0],
		compatibility: { aiHydro: options?.aiHydroRange ?? ">=0.2.5 <0.3.0", packApi: 1, runtimeContract: "html-preview-v1" },
		capabilities: { localPython: "terminal-equivalent", webExternalOrigins: [] },
		environmentPath: "environments/environment.json",
		provenancePath: "provenance/provenance.json",
	}
	const course = {
		courseId: options?.courseId ?? "hmfp",
		title: "Synthetic Course",
		modules: TEST_MODULE_IDS.map((id) => ({ id, path: `modules/${id}/module.html`, title: id })),
	}
	const payload = new Map<string, Uint8Array>([
		["pack.json", canonicalJsonBytes(manifest)],
		["course.json", canonicalJsonBytes(course)],
		[`modules/${TEST_MODULE_IDS[0]}/module.html`, options?.firstModuleBytes ?? moduleHtml(TEST_MODULE_IDS[0], false)],
		[`modules/${TEST_MODULE_IDS[1]}/module.html`, options?.secondModuleBytes ?? moduleHtml(TEST_MODULE_IDS[1], true)],
		["environments/environment.json", canonicalJsonBytes({ python: ">=3.11" })],
		[
			"provenance/provenance.json",
			options?.provenanceBytes ?? canonicalJsonBytes({ buildKind: "development", sourceCommit: "a".repeat(40) }),
		],
	])
	const checksums = buildChecksums(payload)
	const signatureBytes = sign(null, checksums.bytes, privateKey)
	const files = new Map(payload)
	files.set("checksums.json", checksums.bytes)
	files.set("signatures/ed25519.json", signatureDocument(publicKeyDer, signatureBytes))
	return { files, fingerprint }
}

/** Deterministic stored ZIP used only by synthetic public test fixtures (the shared authoring writer). */
export function createLearningPackTestArchive(files: ReadonlyMap<string, Uint8Array>): Buffer {
	return writeStoredZip(files)
}
