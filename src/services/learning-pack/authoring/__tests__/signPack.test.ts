import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { expect } from "chai"
import { canonicalJsonBytes } from "../../canonicalJson"
import { inspectLearningPackArchiveBytes, readLearningPackArchiveEntries } from "../../inspectLearningPackArchive"
import { installLearningPack } from "../../learningPackLifecycle"
import { derivePackTrustState, trustPublisher } from "../../trustStore"
import { assembleUnsignedPack } from "../buildPack"
import { writeStoredZip } from "../contractPrimitives"
import { SignError, signPack } from "../signPack"
import { buildInput, makeKeyPair } from "./authoringTestKit"

const RUNTIME = { aiHydroVersion: "0.4.0" }

async function releaseBuild() {
	const key = makeKeyPair()
	const built = await assembleUnsignedPack(buildInput({ buildKind: "release", publisherSpkiDer: key.publicDer }))
	return { key, built }
}

async function entriesOf(archive: Uint8Array): Promise<Map<string, Uint8Array>> {
	const read = await readLearningPackArchiveEntries(archive)
	expect(read.diagnostics).to.deep.equal([])
	return new Map(read.files)
}

describe("signPack", () => {
	describe("round trip", () => {
		it("a development build signed with an ephemeral key verifies and installs as signed-untrusted (A1)", async () => {
			const built = await assembleUnsignedPack(buildInput())
			const signed = await signPack({ unsigned: built.archive, signer: { kind: "ephemeral" } })
			expect(signed.ephemeral).to.equal(true)
			expect(signed.buildKind).to.equal("development")
			const result = await inspectLearningPackArchiveBytes(signed.archive, RUNTIME)
			expect(result.diagnostics).to.deep.equal([])
			expect(result.status).to.equal("valid")
			expect(result.inspection?.contract.signerFingerprint).to.equal(signed.fingerprint)
			expect(result.inspection?.contract.manifest.publisher.keyId).to.equal(signed.fingerprint)

			const root = await fs.mkdtemp(path.join(os.tmpdir(), "aihydro-pack-install-"))
			try {
				const inspection = result.inspection as NonNullable<typeof result.inspection>
				expect((await installLearningPack(path.join(root, "packs"), inspection, "install-once")).status).to.equal(
					"installed",
				)
				expect(await derivePackTrustState(path.join(root, "packs"), inspection)).to.equal("signed-untrusted")
			} finally {
				await fs.rm(root, { recursive: true, force: true })
			}
		})

		it("a release build signed with a test key becomes trusted-publisher only after that publisher is trusted (A2)", async () => {
			const { key, built } = await releaseBuild()
			const signed = await signPack({ unsigned: built.archive, signer: { kind: "key", privateKey: key.privateKey } })
			expect(signed.ephemeral).to.equal(false)
			expect(signed.buildKind).to.equal("release")
			const result = await inspectLearningPackArchiveBytes(signed.archive, RUNTIME)
			expect(result.status).to.equal("valid")
			expect(result.inspection?.contract.signerFingerprint).to.equal(built.keyId)
			const inspection = result.inspection as NonNullable<typeof result.inspection>

			const root = await fs.mkdtemp(path.join(os.tmpdir(), "aihydro-pack-trust-"))
			try {
				const store = path.join(root, "packs")
				expect(await derivePackTrustState(store, inspection)).to.equal("signed-untrusted")
				expect((await installLearningPack(store, inspection, "install-once")).status).to.equal("installed")
				expect(await derivePackTrustState(store, inspection)).to.equal("signed-untrusted")
				await trustPublisher(store, signed.fingerprint)
				expect(await derivePackTrustState(store, inspection)).to.equal("trusted-publisher")
			} finally {
				await fs.rm(root, { recursive: true, force: true })
			}
		})

		it("signs the exact checksums.json bytes that were in the unsigned archive", async () => {
			const { key, built } = await releaseBuild()
			const signed = await signPack({ unsigned: built.archive, signer: { kind: "key", privateKey: key.privateKey } })
			const files = await entriesOf(signed.archive)
			expect(
				Buffer.from(files.get("checksums.json") as Uint8Array).equals(built.files.get("checksums.json") as Buffer),
			).to.equal(true)
			expect([...files.keys()].sort()).to.deep.equal([...built.files.keys(), "signatures/ed25519.json"].sort())
		})

		it("signing the same release build twice with the same key gives byte-identical archives", async () => {
			const { key, built } = await releaseBuild()
			const first = await signPack({ unsigned: built.archive, signer: { kind: "key", privateKey: key.privateKey } })
			const second = await signPack({ unsigned: built.archive, signer: { kind: "key", privateKey: key.privateKey } })
			expect(first.archive.equals(second.archive)).to.equal(true)
		})
	})

	describe("refusals (nothing is returned, so nothing can be written)", () => {
		it("refuses a key whose fingerprint is not the pack's key ID, naming both fingerprints", async () => {
			const { built } = await releaseBuild()
			const other = makeKeyPair()
			await signPack({ unsigned: built.archive, signer: { kind: "key", privateKey: other.privateKey } }).then(
				() => expect.fail("should refuse"),
				(error) => {
					expect(error).to.be.instanceOf(SignError)
					expect((error as Error).message).to.contain("Key ID mismatch")
					expect((error as Error).message).to.contain(built.keyId)
				},
			)
		})

		it("refuses to sign a development build with a real key, and a release build with an ephemeral key", async () => {
			const key = makeKeyPair()
			const dev = await assembleUnsignedPack(buildInput({ publisherSpkiDer: key.publicDer }))
			await signPack({ unsigned: dev.archive, signer: { kind: "key", privateKey: key.privateKey } }).then(
				() => expect.fail("should refuse"),
				(error) => expect((error as Error).message).to.contain("release builds only"),
			)
			const { built } = await releaseBuild()
			await signPack({ unsigned: built.archive, signer: { kind: "ephemeral" } }).then(
				() => expect.fail("should refuse"),
				(error) => expect((error as Error).message).to.contain("only sign a development build"),
			)
		})

		it("refuses an archive that is already signed", async () => {
			const built = await assembleUnsignedPack(buildInput())
			const signed = await signPack({ unsigned: built.archive, signer: { kind: "ephemeral" } })
			await signPack({ unsigned: signed.archive, signer: { kind: "ephemeral" } }).then(
				() => expect.fail("should refuse"),
				(error) => expect((error as Error).message).to.contain("already signed"),
			)
		})

		it("verifies before returning: a payload altered after the build is caught by the verifier", async () => {
			const { key, built } = await releaseBuild()
			const files = await entriesOf(built.archive)
			const modulePath = "modules/aihydro.intro-demo.water-basics/module.html"
			files.set(
				modulePath,
				Buffer.concat([Buffer.from(files.get(modulePath) as Uint8Array), Buffer.from("<!-- tampered -->")]),
			)
			await signPack({ unsigned: writeStoredZip(files), signer: { kind: "key", privateKey: key.privateKey } }).then(
				() => expect.fail("should refuse"),
				(error) => {
					expect(error).to.be.instanceOf(SignError)
					expect((error as Error).message).to.contain("nothing was written")
					expect((error as Error).message).to.match(/CHECKSUM_MISMATCH|SIZE_MISMATCH/)
				},
			)
		})

		it("refuses an unreadable archive and an archive without an inventory", async () => {
			await signPack({ unsigned: Buffer.from("not a zip"), signer: { kind: "ephemeral" } }).then(
				() => expect.fail("should refuse"),
				(error) => expect(error).to.be.instanceOf(SignError),
			)
			const { built } = await releaseBuild()
			const files = await entriesOf(built.archive)
			files.delete("checksums.json")
			await signPack({ unsigned: writeStoredZip(files), signer: { kind: "ephemeral" } }).then(
				() => expect.fail("should refuse"),
				(error) => expect((error as Error).message).to.contain("no checksums.json"),
			)
		})
	})

	describe("tamper cases the verifier rejects after signing (A3)", () => {
		async function signed() {
			const { key, built } = await releaseBuild()
			const result = await signPack({ unsigned: built.archive, signer: { kind: "key", privateKey: key.privateKey } })
			return { files: await entriesOf(result.archive), key }
		}
		async function codeFor(files: ReadonlyMap<string, Uint8Array>): Promise<string> {
			const result = await inspectLearningPackArchiveBytes(writeStoredZip(files), RUNTIME)
			expect(result.status).to.not.equal("valid")
			return result.diagnostics[0]?.code ?? "none"
		}

		it("checksum mismatch", async () => {
			const { files } = await signed()
			const path = "modules/aihydro.intro-demo.water-basics/module.html"
			const bytes = Buffer.from(files.get(path) as Uint8Array)
			bytes[bytes.length - 3] ^= 1
			files.set(path, bytes)
			expect(await codeFor(files)).to.equal("CHECKSUM_MISMATCH")
		})

		it("invalid signature", async () => {
			const { files } = await signed()
			const document = JSON.parse(Buffer.from(files.get("signatures/ed25519.json") as Uint8Array).toString("utf8"))
			const raw = Buffer.from(document.signature, "base64")
			raw[0] ^= 1
			document.signature = raw.toString("base64")
			files.set("signatures/ed25519.json", canonicalJsonBytes(document))
			expect(await codeFor(files)).to.equal("SIGNATURE_INVALID")
		})

		it("key ID mismatch (a different key re-signs but pack.json still names the original)", async () => {
			const { files } = await signed()
			const other = makeKeyPair()
			const { sign } = await import("node:crypto")
			const { signatureDocument } = await import("../contractPrimitives")
			files.set(
				"signatures/ed25519.json",
				signatureDocument(other.publicDer, sign(null, files.get("checksums.json") as Uint8Array, other.privateKey)),
			)
			expect(await codeFor(files)).to.equal("KEY_ID_MISMATCH")
		})

		it("undeclared file", async () => {
			const { files } = await signed()
			files.set("assets/smuggled.bin", Buffer.from("x"))
			expect(await codeFor(files)).to.equal("UNDECLARED_FILE")
		})

		it("path outside the layout", async () => {
			const { files } = await signed()
			files.set("scripts/run.sh", Buffer.from("x"))
			expect(await codeFor(files)).to.equal("ARCHIVE_PATH_LAYOUT")
		})

		it("case-fold collision", async () => {
			const { files } = await signed()
			files.set("assets/A.png", Buffer.from("x"))
			files.set("assets/a.png", Buffer.from("y"))
			expect(await codeFor(files)).to.equal("ARCHIVE_PATH_CASE_COLLISION")
		})
	})
})
