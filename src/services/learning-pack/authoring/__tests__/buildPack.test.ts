import { generateKeyPairSync, sign } from "node:crypto"
import { expect } from "chai"
import { canonicalJsonBytes, parseCanonicalJson } from "../../canonicalJson"
import { inspectLearningPackArchiveBytes, readLearningPackArchiveEntries } from "../../inspectLearningPackArchive"
import { assembleUnsignedPack, PackBuildError, PLACEHOLDER_KEY_ID, rewriteModuleManifestId } from "../buildPack"
import { buildChecksums, sha256Hex, signatureDocument, spkiFingerprint, writeStoredZip } from "../contractPrimitives"
import { buildInput, makeConfig, makeKeyPair, makeSources, moduleHtml, sourceCourse } from "./authoringTestKit"

const RUNTIME = { aiHydroVersion: "0.4.0" }

function json(files: ReadonlyMap<string, Uint8Array>, path: string): any {
	return parseCanonicalJson(files.get(path) as Uint8Array, path)
}

/** Sign an assembled unsigned pack with a fresh key after re-keying it, exactly like `sign --ephemeral` would. */
async function verifyWithThrowawayKey(files: ReadonlyMap<string, Uint8Array>) {
	const { privateKey, publicKey } = generateKeyPairSync("ed25519")
	const der = publicKey.export({ format: "der", type: "spki" })
	const payload = new Map(files)
	payload.delete("checksums.json")
	const manifest = json(files, "pack.json")
	manifest.publisher.keyId = spkiFingerprint(der)
	payload.set("pack.json", canonicalJsonBytes(manifest))
	const checksums = buildChecksums(payload)
	const archive = new Map(payload)
	archive.set("checksums.json", checksums.bytes)
	archive.set("signatures/ed25519.json", signatureDocument(der, sign(null, checksums.bytes, privateKey)))
	return inspectLearningPackArchiveBytes(writeStoredZip(archive), RUNTIME)
}

describe("assembleUnsignedPack", function () {
	// Git, scrypt and signing are slow on shared Windows runners; the mocha default is 2 s.
	this.timeout(60_000)
	it("builds a pack the real verifier accepts, with namespaced IDs from idMap and idPrefix", async () => {
		const built = await assembleUnsignedPack(buildInput())
		const manifest = json(built.files, "pack.json")
		expect(manifest.ownership).to.deep.equal({
			courseId: "aihydro.intro-demo.course",
			moduleIds: ["aihydro.intro-demo.water-basics", "aihydro.intro-demo.runoff-lab"],
		})
		expect(manifest.entryModuleId).to.equal("aihydro.intro-demo.water-basics")
		expect(manifest.publisher.keyId).to.equal(PLACEHOLDER_KEY_ID)
		const result = await verifyWithThrowawayKey(built.files)
		expect(result.diagnostics).to.deep.equal([])
		expect(result.status).to.equal("valid")
	})

	it("rewrites only the module id inside the vnd.aihydro.module+json block and records it in provenance", async () => {
		const original = moduleHtml("water-basics", { extra: ' mentions water-basics and "id": "water-basics" in the body' })
		const built = await assembleUnsignedPack(
			buildInput({
				sources: makeSources({
					modules: new Map<string, Uint8Array>([
						["water-basics", original],
						["runoff-lab", moduleHtml("runoff-lab")],
					]),
				}),
			}),
		)
		const rewritten = Buffer.from(
			built.files.get("modules/aihydro.intro-demo.water-basics/module.html") as Uint8Array,
		).toString("utf8")
		const before = original.toString("utf8")
		// The ONLY difference is the manifest id value.
		expect(rewritten).to.equal(before.replace('"id": "water-basics",', '"id": "aihydro.intro-demo.water-basics",'))
		expect(rewritten).to.contain('mentions water-basics and "id": "water-basics" in the body')
		const provenance = json(built.files, "provenance/provenance.json")
		expect(provenance.transforms).to.deep.include({
			type: "module-id-rewrite",
			path: "modules/aihydro.intro-demo.water-basics/module.html",
			from: "water-basics",
			to: "aihydro.intro-demo.water-basics",
		})
		expect(provenance.transforms).to.deep.include({
			type: "course-id-rewrite",
			from: "intro-demo-2026",
			to: "aihydro.intro-demo.course",
		})
		expect(provenance.buildKind).to.equal("development")
		expect(provenance.sourceCommit).to.have.length(40)
	})

	it("leaves a nested id key alone and keeps every other manifest field", () => {
		const html = moduleHtml("a", {
			manifestExtra: { requires: { executable: false, python: [], id: "keep-me" }, topic: "t" },
		})
		const out = rewriteModuleManifestId(html, "ns.a", "m").toString("utf8")
		const block = /<script[^>]*>([\s\S]*?)<\/script>/.exec(out)?.[1] as string
		const parsed = JSON.parse(block)
		expect(parsed.id).to.equal("ns.a")
		expect(parsed.requires.id).to.equal("keep-me")
		expect(parsed.topic).to.equal("t")
	})

	it("keeps module bytes untouched and records no rewrite when IDs are unchanged", async () => {
		const sources = makeSources()
		const built = await assembleUnsignedPack(
			buildInput({ config: makeConfig({ idMap: {}, idPrefix: undefined, packId: "intro" }), sources }),
		)
		for (const id of ["water-basics", "runoff-lab"]) {
			expect(
				Buffer.from(built.files.get(`modules/${id}/module.html`) as Uint8Array).equals(
					Buffer.from(sources.modules.get(id) as Uint8Array),
				),
			).to.equal(true)
		}
		const transforms = json(built.files, "provenance/provenance.json").transforms
		expect(transforms.filter((t: { type: string }) => t.type.endsWith("id-rewrite"))).to.deep.equal([])
	})

	it("maps prerequisites and rebuilds course.json from an allowlist (no trustLevel, no downloadUrl)", async () => {
		const built = await assembleUnsignedPack(buildInput())
		const course = json(built.files, "course.json")
		const runoff = course.modules.find((m: { id: string }) => m.id === "aihydro.intro-demo.runoff-lab")
		expect(runoff.prerequisites).to.deep.equal(["aihydro.intro-demo.water-basics"])
		expect(runoff.path).to.equal("modules/aihydro.intro-demo.runoff-lab/module.html")
		expect(JSON.stringify(course)).to.not.contain("trustLevel")
		expect(JSON.stringify(course)).to.not.contain("downloadUrl")
		const transform = json(built.files, "provenance/provenance.json").transforms.find(
			(t: { type: string }) => t.type === "course-manifest-allowlist",
		)
		expect(transform.droppedCourseKeys).to.deep.equal(["trustLevel"])
		expect(transform.droppedModuleKeys).to.deep.equal(["downloadUrl"])
	})

	it("fails closed on idMap keys that match nothing, collisions and invalid pack IDs", async () => {
		await assertRejects(
			buildInput({ config: makeConfig({ idMap: { "no-such-module": "x" } }) }),
			/idMap key "no-such-module"/,
		)
		await assertRejects(
			buildInput({ config: makeConfig({ idPrefix: undefined, idMap: { "water-basics": "same", "runoff-lab": "same" } }) }),
			/both map to pack ID "same"/,
		)
		await assertRejects(buildInput({ config: makeConfig({ idPrefix: "a".repeat(120) }) }), /contract ID pattern/)
	})

	it("refuses a module whose manifest disagrees with course.json, or that has no or several manifest blocks", async () => {
		const wrongId = new Map<string, Uint8Array>([
			["water-basics", moduleHtml("something-else")],
			["runoff-lab", moduleHtml("runoff-lab")],
		])
		await assertRejects(buildInput({ sources: makeSources({ modules: wrongId }) }), /its manifest id is "something-else"/)
		const none = new Map<string, Uint8Array>([
			["water-basics", Buffer.from("<html></html>")],
			["runoff-lab", moduleHtml("runoff-lab")],
		])
		await assertRejects(buildInput({ sources: makeSources({ modules: none }) }), /no vnd.aihydro.module\+json manifest block/)
		const twice = Buffer.concat([moduleHtml("water-basics"), moduleHtml("water-basics")])
		const two = new Map<string, Uint8Array>([
			["water-basics", twice],
			["runoff-lab", moduleHtml("runoff-lab")],
		])
		await assertRejects(buildInput({ sources: makeSources({ modules: two }) }), /2 vnd.aihydro.module\+json manifest blocks/)
	})

	it("refuses to claim no local Python while shipping an executable module", async () => {
		await assertRejects(
			buildInput({ config: makeConfig({ localPython: "none" }) }),
			/requires execution but localPython is "none"/,
		)
	})

	it("lets the real verifier veto what the builder cannot see (unsatisfiable range, oversized module)", async () => {
		await assertRejects(buildInput({ config: makeConfig({ aiHydroRange: ">=2.0.0 <1.0.0" }) }), /matches no version/)
		const huge = new Map<string, Uint8Array>([
			["water-basics", moduleHtml("water-basics", { extra: "x".repeat(8 * 1024 * 1024 + 1) })],
			["runoff-lab", moduleHtml("runoff-lab")],
		])
		await assertRejects(buildInput({ sources: makeSources({ modules: huge }) }), /MODULE_TOO_LARGE/)
	})

	it("needs the publisher public key for a release build and a full commit SHA", async () => {
		await assertRejects(buildInput({ buildKind: "release" }), /needs the publisher's public key/)
		await assertRejects(
			buildInput({ provenance: { sourceCommit: "abc", sourceDirty: false, generatedAt: "2026-10-20T12:00:00Z" } }),
			/full lowercase Git SHA/,
		)
	})

	it("puts the publisher's key ID in pack.json for a release build", async () => {
		const { publicDer } = makeKeyPair()
		const built = await assembleUnsignedPack(buildInput({ buildKind: "release", publisherSpkiDer: publicDer }))
		expect(built.keyId).to.equal(spkiFingerprint(publicDer))
		expect(json(built.files, "pack.json").publisher.keyId).to.equal(built.keyId)
		expect(json(built.files, "provenance/provenance.json").buildKind).to.equal("release")
	})

	it("includes extra files only under the allowed roots and refuses collisions", async () => {
		const extra = new Map<string, Uint8Array>([["datasets/x.csv", Buffer.from("a,b\n1,2\n")]])
		const built = await assembleUnsignedPack(buildInput({ sources: makeSources({ extra }) }))
		expect(Buffer.from(built.files.get("datasets/x.csv") as Uint8Array).toString()).to.equal("a,b\n1,2\n")
		const clash = new Map<string, Uint8Array>([["provenance/provenance.json", Buffer.from("{}")]])
		await assertRejects(buildInput({ sources: makeSources({ extra: clash }) }), /collides with a generated file/)
	})

	it("is deterministic: identical inputs give byte-identical archives, and the archive lists checksums.json", async () => {
		const first = await assembleUnsignedPack(buildInput())
		const second = await assembleUnsignedPack(buildInput())
		expect(sha256Hex(first.archive)).to.equal(sha256Hex(second.archive))
		const entries = await readLearningPackArchiveEntries(first.archive)
		expect([...(entries.files?.keys() ?? [])]).to.include("checksums.json")
		expect([...(entries.files?.keys() ?? [])]).to.not.include("signatures/ed25519.json")
	})

	it("does not mutate its inputs", async () => {
		const course = sourceCourse()
		const snapshot = JSON.stringify(course)
		await assembleUnsignedPack(buildInput({ sources: makeSources({ course }) }))
		expect(JSON.stringify(course)).to.equal(snapshot)
	})
})

async function assertRejects(input: Parameters<typeof assembleUnsignedPack>[0], pattern: RegExp): Promise<void> {
	let failure: unknown
	try {
		await assembleUnsignedPack(input)
	} catch (error) {
		failure = error
	}
	expect(failure, "expected the build to be refused").to.be.instanceOf(PackBuildError)
	expect((failure as Error).message).to.match(pattern)
}
