/**
 * Byte-level building blocks of a Learning Pack, shared by the authoring tools and the test fixtures so that
 * a pack cannot be signed one way and verified another. Pure (no filesystem, no keys).
 *
 * The installed verifier (`validateLearningPack.ts`) stays the single judge of validity: nothing here decides
 * whether a pack is acceptable, it only produces the exact bytes the contract describes.
 */

import { createHash } from "node:crypto"
import { canonicalJsonBytes } from "../canonicalJson"
import { compareContractPaths } from "../contractPaths"
import type { LearningPackChecksums } from "../types"

export { compareContractPaths }

export const CHECKSUMS_PATH = "checksums.json"
export const SIGNATURE_PATH = "signatures/ed25519.json"

/** Every ZIP entry carries this DOS timestamp: 1980-01-01 00:00:00, the earliest value the format can express. */
const DOS_TIME = 0
const DOS_DATE = (0 << 9) | (1 << 5) | 1
const UNIX_REGULAR_FILE_0644 = 0o100644
const ZIP_UTF8_FLAG = 0x800
const ZIP_VERSION = 20
const ZIP_PLATFORM_UNIX = 3
const ZIP_MAX_ENTRIES = 0xffff
const ZIP_MAX_BYTES = 0xffffffff

export function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex")
}

/** `sha256:<hex of the SubjectPublicKeyInfo DER bytes>`, the identity the runtime derives and trusts. */
export function spkiFingerprint(publicKeySpkiDer: Uint8Array): string {
	return `sha256:${sha256Hex(publicKeySpkiDer)}`
}

export interface BuiltChecksums {
	readonly document: LearningPackChecksums
	/** The exact bytes that are signed and archived as `checksums.json`. */
	readonly bytes: Buffer
}

/**
 * The checksum inventory for a payload (everything except `checksums.json` and `signatures/**`), sorted by
 * `compareContractPaths`. Throws if the payload tries to include either excluded path.
 */
export function buildChecksums(payload: ReadonlyMap<string, Uint8Array>): BuiltChecksums {
	for (const path of payload.keys()) {
		if (path === CHECKSUMS_PATH || path.startsWith("signatures/")) {
			throw new Error(`${path} is not part of the signed payload`)
		}
	}
	const files = [...payload.entries()]
		.map(([path, bytes]) => ({ path, sha256: sha256Hex(bytes), size: bytes.byteLength }))
		.sort((a, b) => compareContractPaths(a.path, b.path))
	const document: LearningPackChecksums = { algorithm: "sha256", files }
	return { document, bytes: canonicalJsonBytes(document) }
}

/** `signatures/ed25519.json` bytes. */
export function signatureDocument(publicKeySpkiDer: Uint8Array, signature: Uint8Array): Buffer {
	return canonicalJsonBytes({
		algorithm: "Ed25519",
		publicKeySpki: Buffer.from(publicKeySpkiDer).toString("base64"),
		signature: Buffer.from(signature).toString("base64"),
	})
}

let crcTable: Uint32Array | undefined

function crc32(bytes: Uint8Array): number {
	if (!crcTable) {
		crcTable = new Uint32Array(256)
		for (let index = 0; index < 256; index++) {
			let value = index
			for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1
			crcTable[index] = value >>> 0
		}
	}
	let crc = 0xffffffff
	for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)) >>> 0
	return (crc ^ 0xffffffff) >>> 0
}

/**
 * Deterministic stored (uncompressed) ZIP: entries in `compareContractPaths` order, fixed 1980-01-01 DOS
 * timestamp, regular-file mode 0644, UTF-8 name flag, no extra fields, no comments, no data descriptors.
 * Identical input maps give identical bytes on every host. Not ZIP64: the contract limits are far below it.
 */
export function writeStoredZip(files: ReadonlyMap<string, Uint8Array>): Buffer {
	if (files.size > ZIP_MAX_ENTRIES) throw new Error("Too many entries for a non-ZIP64 archive")
	const localParts: Buffer[] = []
	const centralParts: Buffer[] = []
	let localOffset = 0
	for (const [filePath, value] of [...files].sort(([left], [right]) => compareContractPaths(left, right))) {
		const name = Buffer.from(filePath, "utf8")
		const data = Buffer.from(value)
		const checksum = crc32(data)
		const local = Buffer.alloc(30)
		local.writeUInt32LE(0x04034b50, 0)
		local.writeUInt16LE(ZIP_VERSION, 4)
		local.writeUInt16LE(ZIP_UTF8_FLAG, 6)
		local.writeUInt16LE(0, 8) // stored
		local.writeUInt16LE(DOS_TIME, 10)
		local.writeUInt16LE(DOS_DATE, 12)
		local.writeUInt32LE(checksum, 14)
		local.writeUInt32LE(data.byteLength, 18)
		local.writeUInt32LE(data.byteLength, 22)
		local.writeUInt16LE(name.byteLength, 26)
		local.writeUInt16LE(0, 28)
		localParts.push(local, name, data)

		const central = Buffer.alloc(46)
		central.writeUInt32LE(0x02014b50, 0)
		central.writeUInt16LE((ZIP_PLATFORM_UNIX << 8) | ZIP_VERSION, 4)
		central.writeUInt16LE(ZIP_VERSION, 6)
		central.writeUInt16LE(ZIP_UTF8_FLAG, 8)
		central.writeUInt16LE(0, 10)
		central.writeUInt16LE(DOS_TIME, 12)
		central.writeUInt16LE(DOS_DATE, 14)
		central.writeUInt32LE(checksum, 16)
		central.writeUInt32LE(data.byteLength, 20)
		central.writeUInt32LE(data.byteLength, 24)
		central.writeUInt16LE(name.byteLength, 28)
		central.writeUInt32LE((UNIX_REGULAR_FILE_0644 << 16) >>> 0, 38)
		central.writeUInt32LE(localOffset, 42)
		centralParts.push(central, name)
		localOffset += local.byteLength + name.byteLength + data.byteLength
		if (localOffset > ZIP_MAX_BYTES) throw new Error("Archive is too large for a non-ZIP64 archive")
	}
	const directory = Buffer.concat(centralParts)
	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06054b50, 0)
	end.writeUInt16LE(files.size, 8)
	end.writeUInt16LE(files.size, 10)
	end.writeUInt32LE(directory.byteLength, 12)
	end.writeUInt32LE(localOffset, 16)
	return Buffer.concat([...localParts, directory, end])
}
