import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { getRuleFilesTotalContent, isRetiredResearchDigest } from "@/core/context/instructions/user-instructions/rule-helpers"
import { getSystemPrompt } from "@/core/prompts/system-prompt"
import type { SystemPromptContext } from "@/core/prompts/system-prompt/types"
import type { McpHub } from "@/services/mcp/McpHub"
import { setRecordedFirstPartyLauncher } from "@/shared/aihydro/firstPartyServers"
import type { McpServer } from "@/shared/mcp"
import {
	appendProjectContext,
	contextResourceUri,
	formatProjectContextSection,
	PROJECT_CONTEXT_MAX_BYTES,
	PROJECT_CONTEXT_TRUNCATION_MARKER,
	ProjectContextSection,
	truncateContextText,
} from "../projectContextSection"

const LAUNCHER = { name: "ai-hydro", command: "/opt/miniconda3/bin/aihydro-mcp", args: [] as string[] }
const PRJ = "prj_01KVTESTPROJECT0000000000"
const CHAT = "01KV1EPM88P9FV5CWNVJ9V60JY"

function server(over: Partial<McpServer> = {}): McpServer {
	return {
		name: "ai-hydro",
		status: "connected",
		config: JSON.stringify({ type: "stdio", command: LAUNCHER.command, args: [] }),
		...over,
	} as McpServer
}

const CONTEXT_TEXT = [
	"# Project: Wabash",
	"",
	"## Active study",
	"- baseflow_index = 0.44 [run:r1#key_outputs.baseflow_index]",
	"",
	"**Claims**:",
	"- [claim:c1] (supported)",
].join("\n")

function resource(text: string, found = true) {
	return { contents: [{ uri: "x", text: JSON.stringify({ found, project_id: PRJ, chat_id: CHAT, text }) }] } as any
}

function makeHub(servers: McpServer[], read: sinon.SinonStub) {
	return { getServers: () => servers, readResource: read }
}

describe("project context section (X1-P4)", () => {
	beforeEach(() => setRecordedFirstPartyLauncher(LAUNCHER as any))
	afterEach(() => setRecordedFirstPartyLauncher(undefined))

	describe("fetch policy (spy)", () => {
		it("reads at task start and on a study change, never per turn", async () => {
			const read = sinon.stub().resolves(resource(CONTEXT_TEXT))
			const sec = new ProjectContextSection(makeHub([server()], read))
			const outputs: Array<string | undefined> = []
			// 12 turns: study unknown for 3, bound to s1 for 5, then s2 for 4.
			for (let turn = 0; turn < 12; turn++) {
				const studyId = turn < 3 ? undefined : turn < 8 ? "s1" : "s2"
				outputs.push(await sec.resolve({ projectId: PRJ, chatId: CHAT, studyId }))
			}
			expect(read.callCount).to.equal(3) // start, s1, s2
			expect(sec.fetchCount).to.equal(3)
			expect(read.firstCall.args).to.deep.equal(["ai-hydro", contextResourceUri(PRJ, CHAT)])
			// Within one key the returned section is the identical string.
			expect(new Set(outputs.slice(0, 3)).size).to.equal(1)
			expect(new Set(outputs.slice(3, 8)).size).to.equal(1)
			expect(new Set(outputs.slice(8)).size).to.equal(1)
		})

		it("an unchanged key costs one read over many turns", async () => {
			const read = sinon.stub().resolves(resource(CONTEXT_TEXT))
			const sec = new ProjectContextSection(makeHub([server()], read))
			for (let i = 0; i < 25; i++) {
				await sec.resolve({ projectId: PRJ, chatId: CHAT, studyId: "s1" })
			}
			expect(read.callCount).to.equal(1)
		})

		it("invalidate() forces exactly one more read", async () => {
			const read = sinon.stub().resolves(resource(CONTEXT_TEXT))
			const sec = new ProjectContextSection(makeHub([server()], read))
			await sec.resolve({ projectId: PRJ, chatId: CHAT })
			sec.invalidate()
			await sec.resolve({ projectId: PRJ, chatId: CHAT })
			await sec.resolve({ projectId: PRJ, chatId: CHAT })
			expect(read.callCount).to.equal(2)
		})

		it("builds the resource uri from the chat's project and chat id", () => {
			expect(contextResourceUri(PRJ, CHAT)).to.equal(`aihydro://project/${PRJ}/context?chat=${CHAT}`)
		})
	})

	describe("injects nothing, never throws", () => {
		it("no project: no read", async () => {
			const read = sinon.stub().resolves(resource(CONTEXT_TEXT))
			const sec = new ProjectContextSection(makeHub([server()], read))
			expect(await sec.resolve({ chatId: CHAT })).to.equal(undefined)
			expect(read.callCount).to.equal(0)
		})

		it("an untrusted server of the same name is never read", async () => {
			const read = sinon.stub().resolves(resource(CONTEXT_TEXT))
			const evil = server({ config: JSON.stringify({ type: "stdio", command: "/tmp/evil", args: [] }) })
			const sec = new ProjectContextSection(makeHub([evil], read))
			expect(await sec.resolve({ projectId: PRJ, chatId: CHAT })).to.equal(undefined)
			expect(read.callCount).to.equal(0)
		})

		it("disconnected or disabled server: no read", async () => {
			const read = sinon.stub().resolves(resource(CONTEXT_TEXT))
			for (const over of [{ status: "disconnected" as const }, { disabled: true }]) {
				const sec = new ProjectContextSection(makeHub([server(over)], read))
				expect(await sec.resolve({ projectId: PRJ, chatId: CHAT })).to.equal(undefined)
			}
			expect(read.callCount).to.equal(0)
		})

		it("a server older than 2.8.3 (templates listed, no context template): no read", async () => {
			const read = sinon.stub().resolves(resource(CONTEXT_TEXT))
			const old = server({
				resourceTemplates: [{ uriTemplate: "aihydro://project/{project_id}", name: "project" }],
			})
			const sec = new ProjectContextSection(makeHub([old], read))
			expect(await sec.resolve({ projectId: PRJ, chatId: CHAT })).to.equal(undefined)
			expect(read.callCount).to.equal(0)
		})

		it("a server that lists the context template is read", async () => {
			const read = sinon.stub().resolves(resource(CONTEXT_TEXT))
			const ok = server({
				resourceTemplates: [{ uriTemplate: "aihydro://project/{project_id}/context{?chat}", name: "context" }],
			})
			const sec = new ProjectContextSection(makeHub([ok], read))
			expect(await sec.resolve({ projectId: PRJ, chatId: CHAT })).to.be.a("string")
		})

		it("a failing read, found:false, bad JSON and empty text all yield undefined, once per key", async () => {
			const cases: sinon.SinonStub[] = [
				sinon.stub().rejects(new Error("Unknown resource")),
				sinon.stub().resolves(resource("", true)),
				sinon.stub().resolves(resource("x", false)),
				sinon.stub().resolves({ contents: [{ uri: "x", text: "not json" }] }),
				sinon.stub().resolves({ contents: [] }),
			]
			for (const read of cases) {
				const sec = new ProjectContextSection(makeHub([server()], read))
				for (let i = 0; i < 5; i++) {
					expect(await sec.resolve({ projectId: PRJ, chatId: CHAT })).to.equal(undefined)
				}
				expect(read.callCount).to.equal(1)
			}
		})
	})

	describe("size and truncation", () => {
		const bytes = (s: string) => Buffer.byteLength(s, "utf8")

		it("short text is passed through verbatim inside the frame", () => {
			const section = formatProjectContextSection(CONTEXT_TEXT)
			expect(section).to.contain(CONTEXT_TEXT)
			expect(section).to.not.contain(PROJECT_CONTEXT_TRUNCATION_MARKER)
			expect(bytes(section)).to.be.at.most(PROJECT_CONTEXT_MAX_BYTES)
		})

		it("long text is cut to at most 2 KB with a marker", () => {
			const long = Array.from({ length: 400 }, (_, i) => `- line ${i} of the study digest`).join("\n")
			const section = formatProjectContextSection(long)
			expect(bytes(section)).to.be.at.most(PROJECT_CONTEXT_MAX_BYTES)
			expect(section.endsWith(PROJECT_CONTEXT_TRUNCATION_MARKER)).to.equal(true)
		})

		it("never cuts through a [run:] or [claim:] marker, at any cut point", () => {
			const lines = Array.from(
				{ length: 60 },
				(_, i) => `- v${i} = ${i}.5 [run:run_abc${i}#key_outputs.some_long_field_name_${i}]`,
			)
			const text = lines.join("\n")
			for (let max = 80; max < 700; max++) {
				const out = truncateContextText(text, max)
				expect(bytes(out), `max ${max}`).to.be.at.most(max)
				const body = out.slice(0, out.length - PROJECT_CONTEXT_TRUNCATION_MARKER.length)
				// Every "[" opened in the kept body is closed by a "]" after it.
				let idx = body.indexOf("[")
				while (idx >= 0) {
					expect(body.indexOf("]", idx), `unclosed marker at max ${max}`).to.be.greaterThan(idx)
					idx = body.indexOf("[", idx + 1)
				}
			}
		})

		it("does not split a multi-byte character", () => {
			const text = "é".repeat(2000)
			const out = truncateContextText(text, 500)
			expect(out).to.not.contain("�")
			expect(bytes(out)).to.be.at.most(500)
		})

		it("the framed section of a hostile 1 MB text is still at most 2 KB", async () => {
			const read = sinon.stub().resolves(resource("x".repeat(1_000_000)))
			const sec = new ProjectContextSection(makeHub([server()], read))
			const out = await sec.resolve({ projectId: PRJ, chatId: CHAT })
			expect(bytes(out!)).to.be.at.most(PROJECT_CONTEXT_MAX_BYTES)
		})
	})

	describe("research.md is no longer injected", () => {
		let dir: string
		beforeEach(async () => {
			dir = await fs.mkdtemp(path.join(os.tmpdir(), "x1p4-"))
		})
		afterEach(async () => {
			await fs.rm(dir, { recursive: true, force: true })
		})

		it("recognises the stub and the retired digests", () => {
			expect(isRetiredResearchDigest("<!-- aihydro:research-md-stub -->\n# AI-Hydro research context\n")).to.equal(true)
			expect(isRetiredResearchDigest("# Research Session\n...\n_Skeleton auto-generated by HydroSession_")).to.equal(true)
			expect(isRetiredResearchDigest("# Research Project: X\n...\nAuto-generated by ProjectSession")).to.equal(true)
			expect(isRetiredResearchDigest("# My own rules\nBe terse.")).to.equal(false)
		})

		it("the stub is dropped from the injected rules, other rules stay", async () => {
			const rules = path.join(dir, ".aihydrorules")
			await fs.mkdir(rules)
			await fs.writeFile(
				path.join(rules, "research.md"),
				"<!-- aihydro:research-md-stub -->\n# AI-Hydro research context\n",
			)
			await fs.writeFile(path.join(rules, "style.md"), "Be terse.\n")
			const total = await getRuleFilesTotalContent([path.join(rules, "research.md"), path.join(rules, "style.md")], dir, {})
			expect(total).to.contain("Be terse.")
			expect(total).to.not.contain("research context")
			expect(total).to.not.contain("research.md")
		})
	})

	describe("prompt prefix byte-stability", () => {
		const sha = (s: string) => createHash("sha256").update(s).digest("hex")
		const baseContext = (rules?: string): SystemPromptContext => ({
			cwd: "/test/project",
			ide: "TestIde",
			supportsBrowserUse: false,
			mcpHub: { getServers: () => [] } as unknown as McpHub,
			focusChainSettings: { enabled: false } as any,
			browserSettings: { viewport: { width: 1280, height: 720 } } as any,
			localAiHydroRulesFileInstructions: rules,
			isTesting: true,
			providerInfo: { providerId: "test", model: { id: "fast", info: { supportsPromptCache: false } } } as any,
		})

		it("the whole system prompt is identical on every turn of an unchanged study", async () => {
			const read = sinon.stub().resolves(resource(CONTEXT_TEXT))
			const sec = new ProjectContextSection(makeHub([server()], read))
			const hashes: string[] = []
			for (let turn = 0; turn < 10; turn++) {
				const section = await sec.resolve({ projectId: PRJ, chatId: CHAT, studyId: "s1" })
				hashes.push(sha(appendProjectContext(await getSystemPrompt(baseContext("Be terse.")), section)))
			}
			expect(new Set(hashes).size).to.equal(1)
			expect(read.callCount).to.equal(1)
		})

		it("the base prompt is a byte prefix of the prompt with the section, so the section never shifts the cached part", async () => {
			const base = await getSystemPrompt(baseContext("Be terse."))
			const withSection = appendProjectContext(base, formatProjectContextSection(CONTEXT_TEXT))
			expect(withSection.startsWith(base)).to.equal(true)
			expect(withSection.length).to.be.greaterThan(base.length)
		})

		it("old behaviour (a digest in research.md that changes as runs are made) changes the prompt; the section does not", async () => {
			// Simulated baseline: the retired digest was regenerated after tool runs, so its text, injected through the
			// rules, differed from turn to turn. This is a simulation of that mechanism, not a measurement of the old build.
			const oldHashes = new Set<string>()
			for (let turn = 0; turn < 5; turn++) {
				oldHashes.add(sha(await getSystemPrompt(baseContext(`research.md\n# Research Session\nruns so far: ${turn}`))))
			}
			expect(oldHashes.size).to.equal(5)

			const read = sinon.stub().resolves(resource(CONTEXT_TEXT))
			const sec = new ProjectContextSection(makeHub([server()], read))
			const newHashes = new Set<string>()
			for (let turn = 0; turn < 5; turn++) {
				const section = await sec.resolve({ projectId: PRJ, chatId: CHAT, studyId: "s1" })
				newHashes.add(sha(appendProjectContext(await getSystemPrompt(baseContext()), section)))
			}
			expect(newHashes.size).to.equal(1)
		})
	})
})
