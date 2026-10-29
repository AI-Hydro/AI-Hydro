import { setRecordedFirstPartyLauncher } from "@shared/aihydro/firstPartyServers"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { AIHYDRO_CONTEXT_META_KEY, buildAiHydroCallContext } from "@/core/mcp/aihydroContext"
import {
	candidatesForPicker,
	ensureProject,
	findBindingServer,
	PROJECT_NEEDS_283,
	projectStudies,
	resolveLaunchBinding,
} from "../studyBinding"
import { CAPS_282, CAPS_283, FakeBindingServer, type FakeStudy, fakeServerEntry, LAUNCHER } from "./fakeBindingServer"

const CHAT = "01JCHATULID0000000000000A"
const WS = "/work/maine"
const TRY: FakeStudy = { id: "try", label: "Outlet 45.00N 69.50W (try)", workspace: WS }
const PISC: FakeStudy = { id: "01031500", label: "Piscataquis River near Dover-Foxcroft, ME (USGS 01031500)", workspace: WS }
const ELSEWHERE: FakeStudy = { id: "other", label: "Another basin", workspace: "/work/elsewhere" }
const TEST_STUDY: FakeStudy = { id: "test-x", label: "A test study", workspace: WS, hidden: "test" }

describe("X1-P1 projects on the host side", () => {
	beforeEach(() => setRecordedFirstPartyLauncher(LAUNCHER as any))
	afterEach(() => setRecordedFirstPartyLauncher(undefined))

	describe("_meta.project_id", () => {
		it("is sent in the namespaced meta, beside the chat and workspace, and never as an argument", () => {
			const ctx = buildAiHydroCallContext({ a: 1 }, CHAT, WS, undefined, "prj_01JPROJECT001000000000000")
			const meta = ctx.meta[AIHYDRO_CONTEXT_META_KEY] as Record<string, unknown>
			expect(meta).to.include({ chat_id: CHAT, workspace: WS, project_id: "prj_01JPROJECT001000000000000" })
			expect(JSON.stringify(ctx.args)).to.not.include("prj_")
		})

		it("is absent when the chat has no project", () => {
			const meta = buildAiHydroCallContext({}, CHAT, WS).meta[AIHYDRO_CONTEXT_META_KEY] as Record<string, unknown>
			expect(meta).to.not.have.property("project_id")
		})
	})

	describe("ensureProject", () => {
		it("returns the server-minted id, and the same id for the same folder (idempotent)", async () => {
			const server = new FakeBindingServer([TRY], CAPS_283)
			const a = await ensureProject(server, WS, CHAT)
			const b = await ensureProject(server, WS, CHAT)
			expect(a).to.include({ ok: true, created: true })
			expect(b).to.include({ ok: true, created: false })
			expect(a.ok && b.ok && a.projectId === b.projectId).to.equal(true)
			expect(a.ok && a.projectId).to.match(/^prj_[0-9A-Za-z]{26}$/)
			expect(server.projects.size).to.equal(1)
		})

		it("an older server (no project flag) is a result with the update message, and no call is made", async () => {
			const server = new FakeBindingServer([TRY], CAPS_282)
			const r = await ensureProject(server, WS)
			expect(r).to.deep.include({ ok: false, code: "OLD_SERVER", reason: PROJECT_NEEDS_283 })
			expect(server.calls.filter((c) => c.tool === "ensure_project")).to.have.length(0)
		})

		it("a transient capabilities failure is retried, not taken for an old server", async () => {
			const server = new FakeBindingServer([TRY], CAPS_283)
			const real = server.readResource.bind(server)
			let failures = 2
			server.readResource = async (name: string, uri: string) => {
				if (uri.includes("capabilities") && failures-- > 0) {
					throw new Error("Request timed out")
				}
				return real(name, uri)
			}
			expect(await ensureProject(server, WS, CHAT, [1, 1])).to.include({ ok: true })
		})

		it("a capabilities read that keeps failing is FAILED (retried later), never OLD_SERVER", async () => {
			const server = new FakeBindingServer([TRY], CAPS_283)
			server.readResource = async () => {
				throw new Error("Connection closed")
			}
			expect(await ensureProject(server, WS, CHAT, [1, 1])).to.deep.include({ ok: false, code: "FAILED" })
		})

		it("a 2.8.1 server (no capabilities resource) is also OLD_SERVER", async () => {
			const server = new FakeBindingServer([TRY], null)
			expect(await ensureProject(server, WS)).to.deep.include({ ok: false, code: "OLD_SERVER" })
		})

		it("a missing or untrusted server is NO_SERVER, not a crash", async () => {
			const none = new FakeBindingServer([TRY], CAPS_283, [])
			expect(await ensureProject(none, WS)).to.deep.include({ ok: false, code: "NO_SERVER" })
		})

		it("a registry error is reported with the server's message", async () => {
			const server = new FakeBindingServer([TRY], CAPS_283)
			server.ensureProjectError = "project.json is unreadable"
			const r = await ensureProject(server, WS)
			expect(r.ok).to.equal(false)
			expect(!r.ok && r.reason).to.include("project.json is unreadable")
		})

		it("the host's own call still works when the server marks the tool host-audience (the guard is for the model)", async () => {
			const server = new FakeBindingServer([TRY], CAPS_283, [
				fakeServerEntry({ tools: [{ name: "ensure_project", _meta: { "aihydro/audience": "host" } } as any] }),
			])
			expect(await ensureProject(server, WS)).to.include({ ok: true })
		})

		it("calls the tool directly with root_dir only: no chat id argument, no model-visible indirection", async () => {
			const server = new FakeBindingServer([TRY], CAPS_283)
			await ensureProject(server, WS, CHAT)
			const call = server.calls.find((c) => c.tool === "ensure_project")!
			expect(call.args).to.deep.equal({ root_dir: WS })
		})
	})

	describe("the project's studies", () => {
		it("projectStudies lists labelled studies and leaves out hidden ones", async () => {
			const server = new FakeBindingServer([TRY, PISC, ELSEWHERE, TEST_STUDY], CAPS_283)
			const r = await ensureProject(server, WS)
			expect(r.ok).to.equal(true)
			const got = await projectStudies(server, findBindingServer(server)!, (r as any).projectId)
			expect(got.studies.map((s) => s.label)).to.have.members([TRY.label, PISC.label])
			expect(got.title).to.equal("maine")
		})

		it("a project that is not found throws, so callers fall back to the folder", async () => {
			const server = new FakeBindingServer([TRY], CAPS_283)
			let message = ""
			await projectStudies(server, findBindingServer(server)!, "prj_01JNOSUCHPROJECT0000000000").catch(
				(e) => (message = e.message),
			)
			expect(message).to.include("not found")
		})

		it("the picker offers the project's studies; an empty project offers the folder's, then every visible one", async () => {
			const server = new FakeBindingServer([TRY, PISC, ELSEWHERE], CAPS_283)
			const r: any = await ensureProject(server, WS)
			const inProject = await candidatesForPicker(server, WS, r.projectId)
			expect(inProject.map((c) => c.studyId)).to.have.members(["try", "01031500"])

			const empty: any = await ensureProject(server, "/work/empty")
			const fallback = await candidatesForPicker(server, "/work/empty", empty.projectId)
			expect(fallback.map((c) => c.studyId)).to.have.members(["try", "01031500", "other"])
		})

		it("launch: a chat in a project with one study binds it; the call carries _meta.project_id", async () => {
			const server = new FakeBindingServer([TRY, ELSEWHERE], CAPS_283)
			const r: any = await ensureProject(server, WS)
			const state = await resolveLaunchBinding({ hub: server, chatId: CHAT, workspace: WS, projectId: r.projectId })
			expect(state).to.include({ status: "bound", studyId: "try" })
			expect(state.reason).to.include("project")
			const rebind = server.calls.find((c) => c.tool === "aihydro_rebind_chat")!
			expect(rebind.meta![AIHYDRO_CONTEXT_META_KEY].project_id).to.equal(r.projectId)
		})

		it("launch: several studies in the project ask the user; the candidates are the project's", async () => {
			const server = new FakeBindingServer([TRY, PISC, ELSEWHERE], CAPS_283)
			const r: any = await ensureProject(server, WS)
			const state = await resolveLaunchBinding({ hub: server, chatId: CHAT, workspace: WS, projectId: r.projectId })
			expect(state.status).to.equal("choose")
			expect(state.candidates?.map((c) => c.studyId)).to.have.members(["try", "01031500"])
			expect(state.reason).to.include("this project")
		})

		it("launch without a project (older server) behaves exactly as before: the folder", async () => {
			const server = new FakeBindingServer([TRY, PISC], CAPS_282)
			const state = await resolveLaunchBinding({ hub: server, chatId: CHAT, workspace: WS })
			expect(state.status).to.equal("choose")
			expect(state.reason).to.include("this folder")
			expect(server.calls.every((c) => !c.meta?.[AIHYDRO_CONTEXT_META_KEY]?.project_id)).to.equal(true)
		})
	})
})
