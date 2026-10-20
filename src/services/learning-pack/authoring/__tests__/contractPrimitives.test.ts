import { createPublicKey, generateKeyPairSync, sign } from "node:crypto"
import { expect } from "chai"
import { createValidLearningPackFiles } from "../../__tests__/learningPackTestFixture"
import { canonicalJsonBytes } from "../../canonicalJson"
import { inspectLearningPackArchiveBytes } from "../../inspectLearningPackArchive"
import {
	buildChecksums,
	compareContractPaths,
	sha256Hex,
	signatureDocument,
	spkiFingerprint,
	writeStoredZip,
} from "../contractPrimitives"

const RUNTIME = { aiHydroVersion: "0.2.9" }

/** Strings that exercise every place code-unit order and locale order disagree. */
const CORPUS = [
	"assets/B.png",
	"assets/a.png",
	"assets/A.png",
	"assets/_x",
	"assets/~x",
	"assets/é.png",
	"assets/z.png",
	"assets/Z.png",
	"assets/a-b",
	"assets/a.b",
	"assets/a_b",
	"assets/a b",
	"assets/😀.png",
	"assets/￿",
	"assets/퟿",
	"assets/10",
	"assets/9",
	"modules/a/module.html",
	"modules/a-b/module.html",
	"modules/a.b/module.html",
]

describe("compareContractPaths", () => {
	it("orders exactly like the verifier's previous default sort()", () => {
		expect([...CORPUS].sort(compareContractPaths)).to.deep.equal([...CORPUS].sort())
	})

	it("is identical to the default sort() on 5,000 random strings over mixed alphabets", () => {
		let seed = 0x9e3779b9
		const next = (): number => {
			seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0
			return seed
		}
		const alphabet = ["a", "B", "z", "Z", "0", "9", "-", ".", "_", "/", "é", "ß", "İ", "😀", "\u{1F600}", "￿"]
		const strings = Array.from({ length: 5000 }, () =>
			Array.from({ length: 1 + (next() % 8) }, () => alphabet[next() % alphabet.length]).join(""),
		)
		expect([...strings].sort(compareContractPaths)).to.deep.equal([...strings].sort())
	})

	it("returns 0 only for equal strings and a consistent sign otherwise", () => {
		expect(compareContractPaths("a", "a")).to.equal(0)
		expect(compareContractPaths("B", "a")).to.equal(-1)
		expect(compareContractPaths("a", "B")).to.equal(1)
	})

	it("is not the locale order, so the old fixture comparator could disagree with the verifier", () => {
		const localeOrder = [...CORPUS].sort((left, right) => left.localeCompare(right))
		expect(localeOrder).to.not.deep.equal([...CORPUS].sort(compareContractPaths))
	})
})

describe("buildChecksums", () => {
	it("sorts by contract order and hashes the exact bytes", () => {
		const payload = new Map<string, Uint8Array>([
			["assets/a.png", Buffer.from("a")],
			["assets/B.png", Buffer.from("B")],
		])
		const built = buildChecksums(payload)
		expect(built.document.files.map((entry) => entry.path)).to.deep.equal(["assets/B.png", "assets/a.png"])
		expect(built.document.files[0]).to.deep.equal({ path: "assets/B.png", sha256: sha256Hex(Buffer.from("B")), size: 1 })
		expect(built.bytes.equals(canonicalJsonBytes(built.document))).to.equal(true)
		expect(built.bytes.at(-1)).to.equal(0x0a)
	})

	it("refuses a payload that contains the inventory or a signature", () => {
		expect(() => buildChecksums(new Map([["checksums.json", Buffer.from("x")]]))).to.throw(/not part of the signed payload/)
		expect(() => buildChecksums(new Map([["signatures/ed25519.json", Buffer.from("x")]]))).to.throw(
			/not part of the signed payload/,
		)
	})
})

describe("writeStoredZip", () => {
	function centralDirectory(zip: Buffer): { time: number; date: number; mode: number; method: number; name: string }[] {
		const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
		const count = zip.readUInt16LE(end + 10)
		let offset = zip.readUInt32LE(end + 16)
		const entries = []
		for (let index = 0; index < count; index++) {
			const nameLength = zip.readUInt16LE(offset + 28)
			entries.push({
				method: zip.readUInt16LE(offset + 10),
				time: zip.readUInt16LE(offset + 12),
				date: zip.readUInt16LE(offset + 14),
				mode: zip.readUInt32LE(offset + 38) >>> 16,
				name: zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"),
			})
			offset += 46 + nameLength + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32)
		}
		return entries
	}

	it("is independent of insertion order and stamps 1980-01-01 on stored 0644 entries in contract order", () => {
		const forward = new Map<string, Uint8Array>([
			["assets/B.png", Buffer.from("B")],
			["assets/a.png", Buffer.from("a")],
			["pack.json", Buffer.from("{}\n")],
		])
		const reversed = new Map([...forward].reverse())
		const first = writeStoredZip(forward)
		expect(writeStoredZip(reversed).equals(first)).to.equal(true)
		const entries = centralDirectory(first)
		expect(entries.map((entry) => entry.name)).to.deep.equal(["assets/B.png", "assets/a.png", "pack.json"])
		for (const entry of entries) {
			expect(entry).to.include({ method: 0, time: 0, date: (1 << 5) | 1, mode: 0o100644 })
		}
	})

	it("produces an archive the installed verifier accepts, including paths where locale and code-unit order differ", async () => {
		const { files } = createValidLearningPackFiles()
		const payload = new Map(files)
		payload.delete("checksums.json")
		payload.delete("signatures/ed25519.json")
		payload.set("assets/B.png", Buffer.from("upper"))
		payload.set("assets/a.png", Buffer.from("lower"))
		// Re-sign with a fresh key and a manifest key ID that matches it.
		const { privateKey, publicKey } = generateKeyPairSync("ed25519")
		const der = publicKey.export({ format: "der", type: "spki" })
		const manifest = JSON.parse(Buffer.from(payload.get("pack.json") as Uint8Array).toString("utf8"))
		manifest.publisher.keyId = spkiFingerprint(der)
		payload.set("pack.json", canonicalJsonBytes(manifest))
		const checksums = buildChecksums(payload)
		const archive = new Map(payload)
		archive.set("checksums.json", checksums.bytes)
		archive.set("signatures/ed25519.json", signatureDocument(der, sign(null, checksums.bytes, privateKey)))
		const result = await inspectLearningPackArchiveBytes(writeStoredZip(archive), RUNTIME)
		expect(result.diagnostics).to.deep.equal([])
		expect(result.status).to.equal("valid")
		expect(result.inspection?.contract.signerFingerprint).to.equal(spkiFingerprint(der))
	})
})

describe("fingerprint and signature document", () => {
	it("derives sha256 over the SPKI DER and encodes canonical base64", () => {
		const { publicKey } = generateKeyPairSync("ed25519")
		const der = publicKey.export({ format: "der", type: "spki" })
		expect(spkiFingerprint(der)).to.equal(`sha256:${sha256Hex(der)}`)
		expect(createPublicKey({ key: der, format: "der", type: "spki" }).asymmetricKeyType).to.equal("ed25519")
		const document = JSON.parse(signatureDocument(der, Buffer.from("sig")).toString("utf8"))
		expect(document).to.deep.equal({
			algorithm: "Ed25519",
			publicKeySpki: der.toString("base64"),
			signature: Buffer.from("sig").toString("base64"),
		})
	})
})
