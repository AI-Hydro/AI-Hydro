import type { McpServer } from "@shared/mcp"
import type { BindingHub } from "../studyBinding"

/**
 * An in-memory stand-in for the first-party server, written from its 2.8.2 contract (capabilities flags, the
 * study/list and study/by-artifact resources, aihydro_rebind_chat, aihydro_chat_status, the labelled-candidates
 * error). It is the test's model of the server, not a recording. Not a spec file: no `describe` here.
 */
export const LAUNCHER = { name: "ai-hydro", command: "/opt/miniconda3/bin/aihydro-mcp", args: [] as string[] }

export interface FakeStudy {
	id: string
	label: string
	lastRun?: string
	workspace: string
	/** Why the server hides it from lists and refuses to bind it (a test study, archived). */
	hidden?: string
}

export const CAPS_282 = [
	"binding.v2",
	"binding.chat_id_default",
	"binding.session_binding_field",
	"binding.candidates_in_error",
	"study.list",
	"study.by_artifact",
]

/** The 2.8.3 additions (project registry, T-P1): the flags a host reads, never the version. */
export const CAPS_283 = [...CAPS_282, "project.registry_v2", "project.host_ops", "binding.meta_project_id"]

export function fakeServerEntry(over: Partial<McpServer> = {}): McpServer {
	return {
		name: "ai-hydro",
		status: "connected",
		config: JSON.stringify({ type: "stdio", command: LAUNCHER.command, args: [] }),
		tools: [{ name: "aihydro_chat_status" }, { name: "aihydro_rebind_chat" }, { name: "measure_feature" }],
		...over,
	} as McpServer
}

export class FakeBindingServer implements BindingHub {
	readonly bindings = new Map<string, string>()
	readonly calls: Array<{ tool: string; args: Record<string, any>; chat?: string; meta?: Record<string, any> }> = []
	readonly reads: string[] = []
	artifacts = new Map<string, { resolved: boolean; studyId?: string; candidates: string[] }>()
	/** Projects by folder (the 2.8.3 registry: one per directory, the backend mints the id). */
	readonly projects = new Map<string, { id: string; title: string; studyIds: string[] }>()
	/** Make `ensure_project` fail with this message (a registry error). */
	ensureProjectError?: string

	constructor(
		public studies: FakeStudy[],
		/** null = an older server with no capabilities resource (2.8.1). */
		public caps: string[] | null = CAPS_282,
		public servers: McpServer[] = [fakeServerEntry()],
	) {}

	getServers(): McpServer[] {
		return this.servers
	}

	private row(s: FakeStudy) {
		return { study_id: s.id, label: s.label, last_run: s.lastRun ?? "", workspace_dir: s.workspace }
	}

	async readResource(_server: string, uri: string) {
		this.reads.push(uri)
		const url = new URL(uri)
		const text = (body: unknown) => ({ contents: [{ uri, text: JSON.stringify(body) }] })
		if (url.host === "capabilities") {
			if (!this.caps) {
				throw new Error("Unknown resource")
			}
			return text({ version: "2.8.2", capabilities: this.caps })
		}
		if (url.host === "study" && url.pathname === "/list") {
			if (!this.caps?.includes("study.list")) {
				throw new Error("Unknown resource")
			}
			const ws = url.searchParams.get("workspace")
			const rows = this.studies.filter((s) => !s.hidden && (!ws || s.workspace === ws)).map((s) => this.row(s))
			return text({ studies: rows, n_studies: rows.length })
		}
		if (url.host === "project") {
			if (!this.caps?.includes("project.registry_v2")) {
				throw new Error("Unknown resource")
			}
			const id = decodeURIComponent(url.pathname.slice(1))
			const hit = [...this.projects.entries()].find(([, p]) => p.id === id)
			if (!hit) {
				return text({ found: false, project_id: id })
			}
			const [root, p] = hit
			const rows = p.studyIds.map((sid) => {
				const st = this.studies.find((x) => x.id === sid)
				return {
					study_id: sid,
					label: st?.label ?? `${sid} (unnamed study)`,
					last_run: st?.lastRun ?? null,
					exists: !!st,
					...(st?.hidden ? { hidden: st.hidden } : {}),
				}
			})
			return text({ found: true, project_id: p.id, root_dir: root, title: p.title, studies: rows, n_studies: rows.length })
		}
		if (url.host === "study" && url.pathname === "/by-artifact") {
			const path = url.searchParams.get("path") ?? ""
			const hit = this.artifacts.get(path)
			const candidates = (hit?.candidates ?? []).map((id) => this.row(this.studies.find((s) => s.id === id)!))
			return text({
				path,
				resolved: !!hit?.resolved,
				study_id: hit?.studyId ?? null,
				rule: hit ? "manifest" : null,
				candidates,
			})
		}
		throw new Error(`Unknown resource ${uri}`)
	}

	async callTool(
		_server: string,
		tool: string,
		args: Record<string, any> | undefined,
		ulid: string,
		meta?: Record<string, any>,
	) {
		const a = args ?? {}
		const ctx = meta?.["aihydro/context"]
		const chat: string | undefined = ctx?.chat_id ?? a._chat_id
		this.calls.push({ tool, args: a, chat, meta })
		const reply = (body: unknown, isError = false) => ({
			content: [{ type: "text" as const, text: JSON.stringify(body) }],
			isError,
		})
		if (tool === "aihydro_rebind_chat") {
			const study = this.studies.find((s) => s.id === a.study_id)
			if (!study) {
				return reply(
					{ error: true, code: "STUDY_NOT_FOUND", message: `No study '${a.study_id}' exists; nothing was bound.` },
					true,
				)
			}
			if (study.hidden) {
				return reply(
					{
						error: true,
						code: "STUDY_HIDDEN",
						message: `Study '${study.id}' is hidden (${study.hidden}); nothing was bound.`,
						candidates: [],
					},
					true,
				)
			}
			if (a.chat_id && chat && a.chat_id !== chat) {
				return reply({ error: true, code: "CHAT_ID_MISMATCH", message: "chat_id differs from the injected id" }, true)
			}
			const previous = this.bindings.get(chat!)
			this.bindings.set(chat!, study.id)
			return reply({
				bound_to: study.id,
				study_id: study.id,
				chat_id: chat,
				label: study.label,
				session_binding: {
					chat_id: chat,
					study_id: study.id,
					label: study.label,
					previous_study_id: previous ?? null,
					bound_by: "agent_rebind",
				},
			})
		}
		if (tool === "ensure_project") {
			if (!this.caps?.includes("project.host_ops")) {
				throw new Error(`unknown tool ${tool}`)
			}
			if (this.ensureProjectError) {
				return reply({ error: true, code: "PROJECT_UNREADABLE", message: this.ensureProjectError }, true)
			}
			const root = String(a.root_dir)
			let rec = this.projects.get(root)
			const created = !rec
			if (!rec) {
				const n = String(this.projects.size + 1).padStart(3, "0")
				rec = {
					id: `prj_${`01JPROJECT${n}`.padEnd(26, "0")}`,
					title: root.split("/").filter(Boolean).pop() ?? root,
					// a new project is filled with the studies whose workspace is this folder
					studyIds: this.studies.filter((s) => s.workspace === root).map((s) => s.id),
				}
				this.projects.set(root, rec)
			}
			return reply({ status: created ? "created" : "existing", project_id: rec.id, root_dir: root, title: rec.title })
		}
		if (tool === "aihydro_chat_status") {
			const bound = chat ? this.bindings.get(chat) : undefined
			return reply(
				bound ? { bound: true, study_id: bound, chat_id: chat } : { bound: false, study_id: null, chat_id: chat },
			)
		}
		if (tool === "delineate") {
			// A writer that creates a study and binds the chat; the middleware adds session_binding at the TOP level.
			const id = `basin_${this.studies.length + 1}`
			this.studies.push({ id, label: `Outlet ${id}`, workspace: ctx?.workspace ?? "" })
			const previous = this.bindings.get(chat!)
			this.bindings.set(chat!, id)
			return reply({
				data: { area_km2: 3.2 },
				session_id: id,
				session_binding: {
					chat_id: chat,
					study_id: id,
					label: `Outlet ${id}`,
					previous_study_id: previous ?? null,
					bound_by: "auto_create",
				},
			})
		}
		if (tool === "start_session") {
			// An existing study of another workspace: not re-homed, the chat is not bound.
			return reply({
				session_id: a.session_id,
				session_binding_skipped: "study belongs to a different workspace; the chat was not bound",
			})
		}
		if (tool === "measure_feature") {
			// A read-only tool: it resolves by the chat binding or the call's own session_id, and never binds.
			const bound = a.session_id ?? (chat ? this.bindings.get(chat) : undefined)
			if (bound) {
				return reply({ data: { area_km2: 12.5 }, session_id: bound })
			}
			const cands = this.studies.map((s) => ({ study_id: s.id, label: s.label, last_run: s.lastRun ?? "" })).slice(0, 5)
			return reply(
				{
					error: true,
					code: "SESSION_RESOLUTION_FAILED",
					message: "No study could be resolved for this call.",
					next_tools: ["aihydro_rebind_chat"],
					candidates: this.caps?.includes("binding.candidates_in_error") ? cands : undefined,
				},
				true,
			)
		}
		throw new Error(`unexpected tool ${tool}`)
	}
}
