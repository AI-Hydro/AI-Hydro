import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as os from "node:os"
import * as path from "node:path"
import { type ArtifactTrustSource, readArtifactTrust } from "@shared/artifactTrust"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { ArtifactPreviewService, type ArtifactRef } from "../ArtifactPreviewService"
import {
	ArtifactTrustStore,
	classifyArtifactFile,
	executionDenialMessage,
	hasRecordedToolProvenance,
	isUnsignedMarketplacePath,
} from "../artifactTrust"

function subject(trustSource: ArtifactTrustSource, contentHash = "h1", id = "file_1") {
	return { id, contentHash, trustSource }
}

describe("ArtifactTrustStore", () => {
	it("refuses to allow a static document or an unsigned module", () => {
		const store = new ArtifactTrustStore()
		for (const source of ["document", "unsigned-module"] as const) {
			expect(store.allow(subject(source))).to.equal(false)
			expect(store.isAllowed(subject(source))).to.equal(false)
		}
	})

	it("requires an explicit allow even for trusted sources", () => {
		const store = new ArtifactTrustStore()
		expect(store.isAllowed(subject("learning-pack"))).to.equal(false)
		expect(store.isAllowed(subject("recorded-tool"))).to.equal(false)
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
		store.allow(subject("recorded-tool"))
		store.revoke("file_1")
		expect(store.isAllowed(subject("recorded-tool"))).to.equal(false)
	})

	it("does not honour an allowance if the source later becomes untrusted", () => {
		const store = new ArtifactTrustStore()
		store.allow(subject("learning-pack"))
		expect(store.isAllowed(subject("document"))).to.equal(false)
	})

	it("treats an unknown document as not allowed", () => {
		expect(new ArtifactTrustStore().isAllowed(undefined)).to.equal(false)
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
	let records: string

	beforeEach(() => {
		tmp = mkdtempSync(path.join(os.tmpdir(), "aihydro-trust-"))
		home = path.join(tmp, "home")
		records = path.join(home, ".aihydro", "artifact-records")
		mkdirSync(records, { recursive: true })
	})
	afterEach(() => rmSync(tmp, { recursive: true, force: true }))

	function writeDoc(rel: string, body: string): string {
		const file = path.join(tmp, rel)
		mkdirSync(path.dirname(file), { recursive: true })
		writeFileSync(file, body)
		return file
	}
	function record(body: string, overrides: Record<string, unknown> = {}): void {
		const digest = createHash("sha256").update(body).digest("hex")
		writeFileSync(
			path.join(records, `${digest}.json`),
			JSON.stringify({ schema: "aihydro-artifact-record-v1", sha256: digest, ...overrides }),
		)
	}

	it("is a static document by default", async () => {
		const file = writeDoc("ws/dashboard.html", "<html>external</html>")
		expect(await classifyArtifactFile(file, { installedPack: false, home, recordRoot: records })).to.equal("document")
	})

	it("is a learning pack module when the pack registry resolves it", async () => {
		const file = writeDoc("ws/m.html", "<html></html>")
		expect(await classifyArtifactFile(file, { installedPack: true, home, recordRoot: records })).to.equal("learning-pack")
	})

	it("is a recorded-tool artifact only with a matching host-side record", async () => {
		const body = "<html>report</html>"
		const file = writeDoc("ws/report.html", body)
		record(body)
		expect(await classifyArtifactFile(file, { installedPack: false, home, recordRoot: records })).to.equal("recorded-tool")
	})

	it("loses recorded-tool status when the file is modified after recording", async () => {
		const body = "<html>report</html>"
		const file = writeDoc("ws/report.html", body)
		record(body)
		writeFileSync(file, `${body}<script>evil()</script>`)
		expect(await hasRecordedToolProvenance(file, records)).to.equal(false)
	})

	it("rejects a record with the wrong schema or digest", async () => {
		const body = "<html>x</html>"
		const file = writeDoc("ws/x.html", body)
		record(body, { schema: "something-else" })
		expect(await hasRecordedToolProvenance(file, records)).to.equal(false)
		record(body, { sha256: "0".repeat(64) })
		expect(await hasRecordedToolProvenance(file, records)).to.equal(false)
	})

	it("never reads records from the workspace", async () => {
		const body = "<html>cloned</html>"
		const file = writeDoc("repo/cloned.html", body)
		const digest = createHash("sha256").update(body).digest("hex")
		writeDoc(`repo/.aihydro/artifact-records/${digest}.json`, JSON.stringify({ schema: "aihydro-artifact-record-v1", sha256: digest }))
		expect(await classifyArtifactFile(file, { installedPack: false, home, recordRoot: records })).to.equal("document")
	})

	it("marks files under the marketplace install roots as unsigned modules", async () => {
		const moduleFile = path.join(home, ".aihydro", "modules", "m1", "module.html")
		const courseFile = path.join(home, ".aihydro", "courses", "c1", "m1", "module.html")
		expect(isUnsignedMarketplacePath(moduleFile, home)).to.equal(true)
		expect(isUnsignedMarketplacePath(courseFile, home)).to.equal(true)
		expect(isUnsignedMarketplacePath(path.join(home, ".aihydro", "modules-evil", "x.html"), home)).to.equal(false)
		const file = writeDoc("home/.aihydro/modules/m1/module.html", "<html></html>")
		expect(await classifyArtifactFile(file, { installedPack: false, home, recordRoot: records })).to.equal("unsigned-module")
	})

	it("keeps a marketplace file unsigned even if it has a record", async () => {
		const body = "<html>market</html>"
		const file = writeDoc("home/.aihydro/modules/m1/module.html", body)
		record(body)
		expect(await classifyArtifactFile(file, { installedPack: false, home, recordRoot: records })).to.equal("unsigned-module")
	})
})

describe("ArtifactPreviewService execution gate", () => {
	function makeRef(trustSource: ArtifactTrustSource, contentHash = "h1"): ArtifactRef {
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
			byteLength: 13,
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

	it("denies an unknown artifact", () => {
		expect(makeService().canExecute("nope")).to.equal(false)
		expect(makeService().setExecutionAllowed("nope", true)).to.equal(false)
	})

	it("drops the allowance when the document is re-registered with different content", () => {
		const svc = makeService()
		register(svc, makeRef("recorded-tool", "h1"))
		svc.setExecutionAllowed("file_1", true)
		register(svc, makeRef("recorded-tool", "h2"))
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

	it("notifies subscribers when the allowance changes", () => {
		const svc = makeService()
		register(svc, makeRef("learning-pack"))
		const kinds: string[] = []
		svc.onChange((c) => kinds.push(c.kind))
		svc.setExecutionAllowed("file_1", true)
		expect(kinds).to.deep.equal(["updated"])
	})
})

describe("readArtifactTrust (host/webview shared definition)", () => {
	it("agrees with the store: only a trusted source plus an allowance can execute", () => {
		expect(readArtifactTrust({ trustSource: "learning-pack", executionAllowed: "true" }).canExecute).to.equal(true)
		expect(readArtifactTrust({ trustSource: "document", executionAllowed: "true" }).canExecute).to.equal(false)
	})
})
