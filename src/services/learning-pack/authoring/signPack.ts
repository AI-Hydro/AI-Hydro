/**
 * Sign an unsigned Learning Pack archive, and write nothing unless the result passes the extension's own
 * verifier. This module is the only place a private key touches pack bytes; it is never bundled into the
 * extension (see scripts/verify-extension-bundle.mjs).
 *
 * The signature is over the EXACT `checksums.json` bytes already in the archive. The only exception is the
 * ephemeral development flow, where the throwaway key's fingerprint must be written into `pack.json` first,
 * which changes `pack.json` and therefore the inventory; that flow is refused for anything but development builds.
 */

import { generateKeyPairSync, type KeyObject, sign } from "node:crypto"
import { minVersion } from "semver"
import { canonicalJsonBytes, parseCanonicalJson } from "../canonicalJson"
import { inspectLearningPackArchiveBytes, readLearningPackArchiveEntries } from "../inspectLearningPackArchive"
import type { LearningPackDiagnostic, LearningPackManifest } from "../types"
import {
	buildChecksums,
	CHECKSUMS_PATH,
	SIGNATURE_PATH,
	signatureDocument,
	spkiFingerprint,
	writeStoredZip,
} from "./contractPrimitives"
import { publicKeySpkiDer } from "./keys"

export class SignError extends Error {
	constructor(
		message: string,
		readonly diagnostics: readonly LearningPackDiagnostic[] = [],
	) {
		super(message)
		this.name = "SignError"
	}
}

export type Signer = { kind: "key"; privateKey: KeyObject } | { kind: "ephemeral" }

export interface SignPackInput {
	unsigned: Uint8Array
	signer: Signer
	/** Runtime to verify against. Defaults to the lowest version the pack's own range accepts. */
	aiHydroVersion?: string
}

export interface SignedPack {
	archive: Buffer
	fingerprint: string
	buildKind: "development" | "release"
	ephemeral: boolean
}

function parseObject(files: ReadonlyMap<string, Uint8Array>, path: string): Record<string, unknown> {
	const bytes = files.get(path)
	if (!bytes) throw new SignError(`The archive has no ${path}`)
	try {
		return parseCanonicalJson(bytes, path) as Record<string, unknown>
	} catch (error) {
		throw new SignError(error instanceof Error ? error.message : String(error))
	}
}

function describe(diagnostics: readonly LearningPackDiagnostic[]): string {
	return diagnostics.map((d) => `${d.code}: ${d.message}${d.path ? ` (${d.path})` : ""}`).join("; ")
}

export async function signPack({ unsigned, signer, aiHydroVersion }: SignPackInput): Promise<SignedPack> {
	const read = await readLearningPackArchiveEntries(unsigned)
	if (!read.files) throw new SignError(`The unsigned archive is not readable: ${describe(read.diagnostics)}`, read.diagnostics)
	const files = new Map<string, Uint8Array>(read.files)
	if (files.has(SIGNATURE_PATH)) throw new SignError("The archive is already signed")
	for (const required of [CHECKSUMS_PATH, "pack.json", "provenance/provenance.json"]) {
		if (!files.has(required)) throw new SignError(`The archive has no ${required}; build it with \`aihydro-pack build\``)
	}
	const manifest = parseObject(files, "pack.json") as unknown as LearningPackManifest
	const provenance = parseObject(files, "provenance/provenance.json")
	const buildKind =
		provenance.buildKind === "release" ? "release" : provenance.buildKind === "development" ? "development" : undefined
	if (!buildKind) throw new SignError("provenance.buildKind must be development or release")
	const range = minVersion(manifest.compatibility?.aiHydro ?? "")
	const runtimeVersion = aiHydroVersion ?? range?.version
	if (!runtimeVersion) throw new SignError("The pack's AI-Hydro compatibility range matches no version")

	let privateKey: KeyObject
	let publicDer: Buffer
	if (signer.kind === "ephemeral") {
		if (buildKind !== "development") {
			throw new SignError("An ephemeral key may only sign a development build; this archive is a release build")
		}
		const pair = generateKeyPairSync("ed25519")
		privateKey = pair.privateKey
		publicDer = publicKeySpkiDer(privateKey)
		const rekeyed = { ...manifest, publisher: { ...manifest.publisher, keyId: spkiFingerprint(publicDer) } }
		files.set("pack.json", canonicalJsonBytes(rekeyed))
		const payload = new Map(files)
		payload.delete(CHECKSUMS_PATH)
		files.set(CHECKSUMS_PATH, buildChecksums(payload).bytes)
	} else {
		privateKey = signer.privateKey
		publicDer = publicKeySpkiDer(privateKey)
		const fingerprint = spkiFingerprint(publicDer)
		if (manifest.publisher?.keyId !== fingerprint) {
			throw new SignError(
				`Key ID mismatch: the pack was built for ${String(manifest.publisher?.keyId)} but this key is ${fingerprint}. ` +
					"Rebuild with this key's public key (--publisher-pub).",
			)
		}
		if (buildKind !== "release") {
			throw new SignError("A real key signs release builds only; sign a development build with --ephemeral")
		}
	}

	const checksumsBytes = files.get(CHECKSUMS_PATH) as Uint8Array
	files.set(SIGNATURE_PATH, signatureDocument(publicDer, sign(null, checksumsBytes, privateKey)))
	const archive = writeStoredZip(files)

	// The result must be exactly what the installed verifier accepts, signed by exactly this key.
	const result = await inspectLearningPackArchiveBytes(archive, { aiHydroVersion: runtimeVersion })
	const fingerprint = spkiFingerprint(publicDer)
	if (result.status !== "valid" || result.inspection?.contract.signerFingerprint !== fingerprint) {
		throw new SignError(
			`The signed archive does not verify, so nothing was written: ${describe(result.diagnostics)}`,
			result.diagnostics,
		)
	}
	return { archive, fingerprint, buildKind, ephemeral: signer.kind === "ephemeral" }
}
