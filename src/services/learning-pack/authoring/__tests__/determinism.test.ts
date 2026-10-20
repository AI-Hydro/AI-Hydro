import { createPrivateKey } from "node:crypto"
import { expect } from "chai"
import { assembleUnsignedPack } from "../buildPack"
import { sha256Hex } from "../contractPrimitives"
import { publicKeySpkiDer } from "../keys"
import { signPack } from "../signPack"
import { buildInput } from "./authoringTestKit"

/** A fixed Ed25519 test key (32 bytes of 0x07 as the seed). Test-only: it signs nothing outside this file. */
const FIXED_TEST_KEY = createPrivateKey({
	key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 7)]),
	format: "der",
	type: "pkcs8",
})

/**
 * Golden hashes (A7). They pin the archive bytes for fixed inputs so that any drift in ordering, ZIP header
 * fields, JSON canonicalisation, the DOS timestamp or the checksum inventory fails here on every CI platform,
 * which is what makes "deterministic across operating systems" a checked property rather than a hope.
 */
const GOLDEN = {
	unsignedSha256: "24e1b408692dfeac72aef9b8d4b4a9f5a98f9543fb96a197c0533e988ef21a17",
	signedSha256: "788f2d3682b9f532ed5d23929d543c55b80ba31de8ab31ad648bc3395dea6e9b",
	keyId: "sha256:324be2dea8bc44461b0233e51fa48902ed6b1cc671e7739af2551e0bfe68f54e",
}

describe("deterministic archives (A7)", function () {
	// Git, scrypt and signing are slow on shared Windows runners; the mocha default is 2 s.
	this.timeout(60_000)
	async function release() {
		const built = await assembleUnsignedPack(
			buildInput({ buildKind: "release", publisherSpkiDer: publicKeySpkiDer(FIXED_TEST_KEY) }),
		)
		const signed = await signPack({ unsigned: built.archive, signer: { kind: "key", privateKey: FIXED_TEST_KEY } })
		return { built, signed }
	}

	it("rebuilding and re-signing gives identical bytes", async () => {
		const first = await release()
		const second = await release()
		expect(sha256Hex(first.built.archive)).to.equal(sha256Hex(second.built.archive))
		expect(sha256Hex(first.signed.archive)).to.equal(sha256Hex(second.signed.archive))
	})

	it("matches the pinned golden hashes", async () => {
		const { built, signed } = await release()
		const actual = {
			unsignedSha256: sha256Hex(built.archive),
			signedSha256: sha256Hex(signed.archive),
			keyId: built.keyId,
		}
		expect(actual).to.deep.equal(GOLDEN)
	})

	it("changes when a signed input changes (the golden is not a constant)", async () => {
		const base = await release()
		const other = await assembleUnsignedPack(
			buildInput({
				buildKind: "release",
				publisherSpkiDer: publicKeySpkiDer(FIXED_TEST_KEY),
				provenance: { sourceCommit: "f".repeat(40), sourceDirty: false, generatedAt: "2026-10-20T12:00:00Z" },
			}),
		)
		expect(sha256Hex(other.archive)).to.not.equal(sha256Hex(base.built.archive))
	})
})
