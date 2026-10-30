import { setRecordedFirstPartyLauncher } from "@shared/aihydro/firstPartyServers"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { findBindingServer, parseBindingSignal, resolveLaunchBinding } from "../studyBinding"
import { CAPS_282, FakeBindingServer, type FakeStudy, fakeServerEntry, LAUNCHER } from "./fakeBindingServer"

const CHAT = "01JCHATULID0000000000000A"
const WS = "/work/maine"
const A: FakeStudy = {
	id: "01031500",
	label: "Piscataquis River near Dover-Foxcroft, ME (USGS 01031500)",
	workspace: WS,
	lastRun: "2026-08-02T14:03:00Z",
}
const B: FakeStudy = { id: "basin_45p1_69p3", label: "Outlet 45.10N 69.30W", workspace: WS }
const ELSEWHERE: FakeStudy = { id: "other", label: "Other river", workspace: "/work/elsewhere" }

describe("studyBinding (X0-2: host-side binding through the server's resources)", () => {
	beforeEach(() => setRecordedFirstPartyLauncher(LAUNCHER as any))
	afterEach(() => setRecordedFirstPartyLauncher(undefined))

	const resolve = (server: FakeBindingServer, extra: Record<string, unknown> = {}) =>
		resolveLaunchBinding({ hub: server, chatId: CHAT, workspace: WS, ...extra })

	describe("new chat in a folder", () => {
		it("binds the only study in the folder, with the server's label, and says why", async () => {
			const server = new FakeBindingServer([A, ELSEWHERE])
			const state = await resolve(server)
			expect(state).to.include({ status: "bound", studyId: A.id, label: A.label, by: "workspace", canChoose: true })
			expect(server.bindings.get(CHAT)).to.equal(A.id)
			expect(server.calls.filter((c) => c.tool === "aihydro_rebind_chat")).to.have.length(1)
		})

		it("never binds when the folder has several studies: it offers labelled candidates", async () => {
			const server = new FakeBindingServer([A, B, ELSEWHERE])
			const state = await resolve(server)
			expect(state.status).to.equal("choose")
			expect(state.candidates?.map((c) => c.label)).to.deep.equal([A.label, B.label])
			expect(server.bindings.size).to.equal(0)
			expect(server.calls.filter((c) => c.tool === "aihydro_rebind_chat")).to.have.length(0)
		})

		it("a folder with no study is 'none', not a guess from another folder", async () => {
			const server = new FakeBindingServer([ELSEWHERE])
			const state = await resolve(server)
			expect(state.status).to.equal("none")
			expect(server.bindings.size).to.equal(0)
		})
	})

	describe("map launch", () => {
		it("binds the layer's catalogue study before anything else", async () => {
			const server = new FakeBindingServer([A, B])
			const state = await resolve(server, { hint: { sessionId: B.id } })
			expect(state).to.include({ status: "bound", studyId: B.id, by: "map-layer" })
			expect(server.bindings.get(CHAT)).to.equal(B.id)
		})

		it("falls back to the artifact manifest when the catalogue id is not a study", async () => {
			const server = new FakeBindingServer([A, B])
			server.artifacts.set("/work/maine/ws.geojson", { resolved: true, studyId: A.id, candidates: [A.id] })
			const state = await resolve(server, { hint: { sessionId: "not-a-study", artifactPath: "/work/maine/ws.geojson" } })
			expect(state).to.include({ status: "bound", studyId: A.id, by: "map-artifact" })
		})

		it("an artifact two studies could own is a picker, never a guess", async () => {
			const server = new FakeBindingServer([A, B])
			server.artifacts.set("/work/maine/ws.geojson", { resolved: false, candidates: [A.id, B.id] })
			const state = await resolve(server, { hint: { artifactPath: "/work/maine/ws.geojson" } })
			expect(state.status).to.equal("choose")
			expect(state.candidates?.map((c) => c.studyId)).to.deep.equal([A.id, B.id])
			expect(server.bindings.size).to.equal(0)
		})
	})

	describe("resume", () => {
		it("a chat the server still has bound stays bound", async () => {
			const server = new FakeBindingServer([A, B])
			server.bindings.set(CHAT, B.id)
			const state = await resolve(server, { resuming: true })
			expect(state).to.include({ status: "bound", studyId: B.id, by: "resume" })
			expect(server.calls.filter((c) => c.tool === "aihydro_rebind_chat")).to.have.length(0)
		})

		it("rebinds to the mirrored study when the server lost the binding, and does not guess otherwise", async () => {
			const server = new FakeBindingServer([A, B])
			const state = await resolve(server, { resuming: true, resumeStudyId: A.id })
			expect(state).to.include({ status: "bound", studyId: A.id })
			const fresh = new FakeBindingServer([A, B])
			expect((await resolve(fresh, { resuming: true })).status).to.equal("choose")
		})
	})

	describe("fail-closed and older servers", () => {
		it("no connected trusted server: unavailable, and nothing is sent", async () => {
			const none = new FakeBindingServer([A], CAPS_282, [])
			expect((await resolve(none)).status).to.equal("unavailable")
			const untrusted = new FakeBindingServer([A], CAPS_282, [
				fakeServerEntry({ config: JSON.stringify({ type: "stdio", command: "/usr/bin/evil", args: [] }) }),
			])
			expect((await resolve(untrusted)).status).to.equal("unavailable")
			const lookalike = new FakeBindingServer([A], CAPS_282, [fakeServerEntry({ name: "aihydro-evil" })])
			expect(findBindingServer(lookalike)).to.equal(undefined)
			for (const s of [none, untrusted, lookalike]) {
				expect(s.calls).to.have.length(0)
				expect(s.reads).to.have.length(0)
			}
		})

		it("a 2.8.1 server (no capabilities, no study resources) degrades: unavailable, picker off, no folder guess", async () => {
			const server = new FakeBindingServer([A], null)
			const state = await resolve(server)
			expect(state).to.include({ status: "unavailable", canChoose: false })
			expect(server.bindings.size).to.equal(0)
		})

		it("a 2.8.1 server still binds a layer's own study through the rebind tool (chat id passed explicitly)", async () => {
			const server = new FakeBindingServer([A], null)
			const state = await resolve(server, { hint: { sessionId: A.id } })
			expect(state).to.include({ status: "bound", studyId: A.id, canChoose: false })
			expect(server.calls.find((c) => c.tool === "aihydro_rebind_chat")?.args.chat_id).to.equal(CHAT)
		})

		it("a resource that errors is unavailable, never a study", async () => {
			const server = new FakeBindingServer([A])
			server.readResource = async () => {
				throw new Error("boom")
			}
			const state = await resolve(server)
			expect(state.status).to.not.equal("bound")
			expect(server.bindings.size).to.equal(0)
		})
	})

	describe("parseBindingSignal", () => {
		it("reads session_binding without knowing the tool", () => {
			const sig = parseBindingSignal(
				JSON.stringify({
					data: 1,
					session_binding: {
						chat_id: CHAT,
						study_id: A.id,
						label: A.label,
						previous_study_id: null,
						bound_by: "auto_create",
					},
				}),
			)
			expect(sig).to.deep.include({ kind: "binding" })
			expect((sig as any).binding).to.include({ chatId: CHAT, studyId: A.id, label: A.label, boundBy: "auto_create" })
		})

		it("reads labelled candidates from a SESSION_RESOLUTION_FAILED error, also when the transport wraps it in prose", () => {
			const body = {
				error: true,
				code: "SESSION_RESOLUTION_FAILED",
				message: "m",
				candidates: [{ study_id: A.id, label: A.label, last_run: "" }],
			}
			for (const text of [
				JSON.stringify(body),
				`Error:\n${JSON.stringify(body)}`,
				`Error calling tool: ${JSON.stringify(body)}`,
			]) {
				const sig = parseBindingSignal(text)
				expect(sig?.kind).to.equal("unresolved")
				expect((sig as any).candidates[0]).to.deep.include({ studyId: A.id, label: A.label })
			}
		})

		it("ignores everything else", () => {
			expect(parseBindingSignal("")).to.equal(undefined)
			expect(parseBindingSignal(JSON.stringify({ data: { session_binding_note: "x" } }))).to.equal(undefined)
			expect(parseBindingSignal("not json session_binding")).to.equal(undefined)
		})
	})
})

describe("studyBinding: a connected server whose launcher is not confirmed (Trust UX)", () => {
	afterEach(() => setRecordedFirstPartyLauncher(undefined))

	it("is 'unavailable' with cause untrusted_server and the exact command, not 'not connected'", async () => {
		setRecordedFirstPartyLauncher({ ...LAUNCHER, command: "/opt/old/aihydro-mcp" } as any)
		const state = await resolveLaunchBinding({ hub: new FakeBindingServer([A]), chatId: CHAT, workspace: WS })
		expect(state).to.include({ status: "unavailable", cause: "untrusted_server" })
		expect(state.reason).to.contain(`running from a new location (\`${LAUNCHER.command}\`)`)
		expect(state.reason).to.not.contain("not connected")
	})

	it("a server that is not connected has no cause (the trust action would not help)", async () => {
		setRecordedFirstPartyLauncher({ ...LAUNCHER, command: "/opt/old/aihydro-mcp" } as any)
		const hub = new FakeBindingServer([A], undefined, [fakeServerEntry({ status: "disconnected" })])
		const state = await resolveLaunchBinding({ hub, chatId: CHAT, workspace: WS })
		expect(state.status).to.equal("unavailable")
		expect(state.cause).to.equal(undefined)
	})

	it("re-resolving after the anchor is confirmed binds the study (what the host does after the dialog)", async () => {
		setRecordedFirstPartyLauncher({ ...LAUNCHER, command: "/opt/old/aihydro-mcp" } as any)
		const hub = new FakeBindingServer([A])
		expect((await resolveLaunchBinding({ hub, chatId: CHAT, workspace: WS })).status).to.equal("unavailable")
		setRecordedFirstPartyLauncher(LAUNCHER as any)
		const state = await resolveLaunchBinding({ hub, chatId: CHAT, workspace: WS })
		expect(state).to.include({ status: "bound", studyId: A.id })
	})
})
