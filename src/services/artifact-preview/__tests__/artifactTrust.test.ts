import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { type ArtifactTrustSource, readArtifactTrust } from "@shared/artifactTrust"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { ArtifactPreviewService, type ArtifactRef } from "../ArtifactPreviewService"
import { ArtifactTrustStore, classifyArtifactFile, executionDenialMessage, isUnsignedMarketplacePath } from "../artifactTrust"

function subject(trustSource: ArtifactTrustSource, contentHash = "h1", id = "file_1", servedFromSnapshot = true) {
	return { id, contentHash, trustSource, servedFromSnapshot }
}

describe("ArtifactTrustStore", () => {
	it("refuses to allow a static document or an unsigned module", () => {
		const store = new ArtifactTrustStore()
		for (const source of ["document", "unsigned-module"] as const) {
			expect(store.allow(subject(source))).to.equal(false)
			expect(store.isAllowed(subject(source))).to.equal(false)
		}
	})

	it("requires an explicit allow even for a trusted source", () => {
		const store = new ArtifactTrustStore()
		expect(store.isAllowed(subject("learning-pack"))).to.equal(false)
		expect(store.allow(subject("learning-pack"))).to.equal(true)
		expect(store.isAllowed(subject("learning-pack"))).to.equal(true)
	})

	it("is per document", () => {
		const store = new ArtifactTrustStore()
		store.allow(subject("learning-pack", "h1", "a"))
		expect(store.isAllowed(subject("learning-pack", "h1", "b"))).to.equal(false)
	})

	it("lapses when the document content changes", () => {
		const store = new ArtifactTrustStore()
		store.allow(subject("learning-pack", "h1"))
		expect(store.isAllowed(subject("learning-pack", "h2"))).to.equal(false)
	})

	it("revokes", () => {
		const store = new ArtifactTrustStore()
		store.allow(subject("learning-pack"))
		store.revoke("file_1")
		expect(store.isAllowed(subject("learning-pack"))).to.equal(false)
	})

	it("does not honour an allowance if the source later becomes untrusted", () => {
		const store = new ArtifactTrustStore()
		store.allow(subject("learning-pack"))
		expect(store.isAllowed(subject("document"))).to.equal(false)
	})

	it("treats an unknown document as not allowed", () => {
		expect(new ArtifactTrustStore().isAllowed(undefined)).to.equal(false)
	})

	it("never holds an allowance for a document served from the live file instead of the hashed snapshot", () => {
		const store = new ArtifactTrustStore()
		expect(store.allow(subject("learning-pack", "h1", "file_1", false))).to.equal(false)
		expect(store.isAllowed(subject("learning-pack", "h1", "file_1", false))).to.equal(false)
		// An allowance granted while served from the snapshot lapses if the document later
		// falls back to the live file.
		store.allow(subject("learning-pack", "h1", "file_1", true))
		expect(store.isAllowed(subject("learning-pack", "h1", "file_1", false))).to.equal(false)
	})

	describe("e2e-fixture source", () => {
		const saved = { E2E_TEST: process.env.E2E_TEST, AIHYDRO_ENVIRONMENT: process.env.AIHYDRO_ENVIRONMENT }
		afterEach(() => {
			for (const [key, value] of Object.entries(saved)) {
				if (value === undefined) delete process.env[key]
				else process.env[key] = value
			}
		})

		it("cannot be allowed outside the isolated e2e host", () => {
			delete process.env.E2E_TEST
			expect(new ArtifactTrustStore().allow(subject("e2e-fixture"))).to.equal(false)
		})

		it("can be allowed inside the isolated e2e host", () => {
			process.env.E2E_TEST = "true"
			process.env.AIHYDRO_ENVIRONMENT = "local"
			expect(new ArtifactTrustStore().allow(subject("e2e-fixture"))).to.equal(true)
		})
	})
})

describe("executionDenialMessage", () => {
	it("says a static document is not an executable module", () => {
		expect(executionDenialMessage("document", "untrusted")).to.match(/not an executable module/)
	})
	it("names unsigned marketplace modules", () => {
		expect(executionDenialMessage("unsigned-module", "untrusted")).to.match(/unsigned marketplace module/)
	})
	it("points a trusted-but-not-allowed document at the trust bar", () => {
		expect(executionDenialMessage("learning-pack", "not-allowed")).to.match(/Allow execution/)
	})
})

describe("artifact source classification", () => {
	let tmp: string
	let home: string

	beforeEach(() => {
		tmp = mkdtempSync(path.join(os.tmpdir(), "aihydro-trust-"))
		home = path.join(tmp, "home")
		mkdirSync(home, { recursive: true })
	})
	afterEach(() => rmSync(tmp, { recursive: true, force: true }))

	function writeDoc(rel: string, body: string): string {
		const file = path.join(tmp, rel)
		mkdirSync(path.dirname(file), { recursive: true })
		writeFileSync(file, body)
		return file
	}
	const e2eEnv = (trusted: string): NodeJS.ProcessEnv => ({
		E2E_TEST: "true",
		AIHYDRO_ENVIRONMENT: "local",
		AIHYDRO_E2E_TRUSTED_FIXTURES: trusted,
	})

	it("is a static document by default", async () => {
		const file = writeDoc("ws/dashboard.html", "<html>external</html>")
		expect(await classifyArtifactFile(file, { installedPack: false, home, env: {} })).to.equal("document")
	})

	it("is a learning pack module when the verified pack registry resolves it", async () => {
		const file = writeDoc("ws/m.html", "<html></html>")
		expect(await classifyArtifactFile(file, { installedPack: true, home, env: {} })).to.equal("learning-pack")
	})

	it("has no provenance-record trust origin: a record in the workspace or home grants nothing", async () => {
		const body = "<html>cloned</html>"
		const file = writeDoc("repo/cloned.html", body)
		writeDoc("repo/.aihydro/artifact-records/x.json", JSON.stringify({ schema: "aihydro-artifact-record-v1" }))
		writeDoc("home/.aihydro/artifact-records/x.json", JSON.stringify({ schema: "aihydro-artifact-record-v1" }))
		expect(await classifyArtifactFile(file, { installedPack: false, home, env: {} })).to.equal("document")
	})

	it("marks files under the marketplace install roots as unsigned modules", async () => {
		const moduleFile = writeDoc("home/.aihydro/modules/m1/module.html", "<html></html>")
		const courseFile = writeDoc("home/.aihydro/courses/c1/m1/module.html", "<html></html>")
		expect(await isUnsignedMarketplacePath(moduleFile, home)).to.equal(true)
		expect(await isUnsignedMarketplacePath(courseFile, home)).to.equal(true)
		const lookalike = writeDoc("home/.aihydro/modules-evil/x.html", "<html></html>")
		expect(await isUnsignedMarketplacePath(lookalike, home)).to.equal(false)
		expect(await classifyArtifactFile(moduleFile, { installedPack: false, home, env: {} })).to.equal("unsigned-module")
	})

	it("sees through a symlink into the marketplace install root", async function () {
		const target = writeDoc("home/.aihydro/modules/m1/module.html", "<html></html>")
		const link = path.join(tmp, "ws", "innocent.html")
		mkdirSync(path.dirname(link), { recursive: true })
		try {
			symlinkSync(target, link)
		} catch {
			this.skip() // symlinks need privileges on some Windows runners
		}
		expect(await classifyArtifactFile(link, { installedPack: false, home, env: {} })).to.equal("unsigned-module")
	})

	describe("e2e-fixture", () => {
		it("is trusted only for listed paths and only in the isolated e2e host", async () => {
			const listed = writeDoc("ws/fixtures/a.html", "<html></html>")
			const other = writeDoc("ws/other/b.html", "<html></html>")
			const env = e2eEnv(path.join(tmp, "ws", "fixtures"))
			expect(await classifyArtifactFile(listed, { installedPack: false, home, env })).to.equal("e2e-fixture")
			expect(await classifyArtifactFile(other, { installedPack: false, home, env })).to.equal("document")
			// Same variable without the isolated-host markers is ignored.
			expect(
				await classifyArtifactFile(listed, {
					installedPack: false,
					home,
					env: { AIHYDRO_E2E_TRUSTED_FIXTURES: path.join(tmp, "ws", "fixtures") },
				}),
			).to.equal("document")
			expect(
				await classifyArtifactFile(listed, {
					installedPack: false,
					home,
					env: { ...env, AIHYDRO_ENVIRONMENT: "production" },
				}),
			).to.equal("document")
		})

		it("never overrides the unsigned marketplace label", async () => {
			const file = writeDoc("home/.aihydro/modules/m1/module.html", "<html></html>")
			const env = e2eEnv(path.join(home, ".aihydro", "modules"))
			expect(await classifyArtifactFile(file, { installedPack: false, home, env })).to.equal("unsigned-module")
		})
	})
})

describe("ArtifactPreviewService execution gate", () => {
	function makeRef(trustSource: ArtifactTrustSource, contentHash = "h1", byteLength = 13): ArtifactRef {
		return {
			id: "file_1",
			title: "t",
			source: "file",
			mode: "interactive",
			fsPath: "/tmp/t.html",
			dirFsPath: "/tmp",
			contentHash,
			createdAt: 0,
			html: "<html></html>",
			byteLength,
			trustSource,
			metadata: {},
		}
	}
	function makeService(): ArtifactPreviewService {
		return new ArtifactPreviewService({ globalStorageUri: { fsPath: "/tmp/gs", toString: () => "/tmp/gs" } } as never)
	}
	function register(svc: ArtifactPreviewService, ref: ArtifactRef): void {
		;(svc as unknown as { upsert(r: ArtifactRef): void }).upsert(ref)
	}

	it("denies by default, allows after an explicit allow, denies after revoke", () => {
		const svc = makeService()
		register(svc, makeRef("learning-pack"))
		expect(svc.canExecute("file_1")).to.equal(false)
		expect(svc.setExecutionAllowed("file_1", true)).to.equal(true)
		expect(svc.canExecute("file_1")).to.equal(true)
		expect(svc.setExecutionAllowed("file_1", false)).to.equal(false)
		expect(svc.canExecute("file_1")).to.equal(false)
	})

	it("never allows a static document or an unsigned module", () => {
		for (const source of ["document", "unsigned-module"] as const) {
			const svc = makeService()
			register(svc, makeRef(source))
			expect(svc.setExecutionAllowed("file_1", true)).to.equal(false)
			expect(svc.canExecute("file_1")).to.equal(false)
		}
	})

	it("never allows a document too large for the hashed snapshot (it would load from the live file)", () => {
		const svc = makeService()
		register(svc, makeRef("learning-pack", "h1", 200 * 1024 * 1024))
		expect(svc.setExecutionAllowed("file_1", true)).to.equal(false)
		expect(svc.canExecute("file_1")).to.equal(false)
	})

	it("denies an unknown artifact", () => {
		expect(makeService().canExecute("nope")).to.equal(false)
		expect(makeService().setExecutionAllowed("nope", true)).to.equal(false)
	})

	it("clears the allowance on re-registration with different content, even if it later reverts", () => {
		const svc = makeService()
		register(svc, makeRef("learning-pack", "h1"))
		svc.setExecutionAllowed("file_1", true)
		register(svc, makeRef("learning-pack", "h2"))
		expect(svc.canExecute("file_1")).to.equal(false)
		register(svc, makeRef("learning-pack", "h1"))
		expect(svc.canExecute("file_1"), "a stale allowance must not revive when the old bytes return").to.equal(false)
	})

	it("clears the allowance when provenance changes", () => {
		const svc = makeService()
		register(svc, makeRef("learning-pack", "h1"))
		svc.setExecutionAllowed("file_1", true)
		register(svc, makeRef("document", "h1"))
		register(svc, makeRef("learning-pack", "h1"))
		expect(svc.canExecute("file_1")).to.equal(false)
	})

	it("drops the allowance when the artifact is removed", () => {
		const svc = makeService()
		register(svc, makeRef("learning-pack"))
		svc.setExecutionAllowed("file_1", true)
		svc.remove("file_1")
		register(svc, makeRef("learning-pack"))
		expect(svc.canExecute("file_1")).to.equal(false)
	})

	it("does not emit a service change (that would rebuild the whole panel)", () => {
		const svc = makeService()
		register(svc, makeRef("learning-pack"))
		const kinds: string[] = []
		svc.onChange((c) => kinds.push(c.kind))
		svc.setExecutionAllowed("file_1", true)
		svc.setExecutionAllowed("file_1", false)
		expect(kinds).to.deep.equal([])
	})
})

describe("readArtifactTrust (host/webview shared definition)", () => {
	it("agrees with the store: only a trusted source plus an allowance can execute", () => {
		expect(readArtifactTrust({ trustSource: "learning-pack", executionAllowed: "true" }).canExecute).to.equal(true)
		expect(readArtifactTrust({ trustSource: "document", executionAllowed: "true" }).canExecute).to.equal(false)
		expect(readArtifactTrust({ trustSource: "recorded-tool", executionAllowed: "true" }).canExecute).to.equal(false)
	})
})
