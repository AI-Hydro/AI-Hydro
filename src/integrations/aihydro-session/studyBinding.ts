import { canOfferTrustAction, isServerTrusted, launchLineOfConfig, newLauncherSentence } from "@shared/aihydro/firstPartyServers"
import type { StudyBindingState, StudyCandidateView } from "@shared/ExtensionMessage"
import type { McpResourceResponse, McpServer, McpToolCallResponse } from "@shared/mcp"
import { buildAiHydroCallContext } from "@/core/mcp/aihydroContext"
import { isAiHydroServerName } from "@/core/task/tools/handlers/aiHydroServer"

/**
 * Host side of "which study is this chat bound to" (X0-2). Everything goes through the server's own resources and
 * tools; the extension reads none of its files. The server decides what a study is and how it is labelled.
 *
 * Fail-closed: when the server cannot be asked (not connected, not trusted, a resource errors) the answer is
 * `unavailable`, never a guessed study. Nothing here binds a chat to a study the user or the server's own evidence
 * (a layer's study id, the artifact manifest, the only study in the folder, the stored binding) did not name.
 */

/** Shown where a study list is needed and the server cannot give one. */
export const STUDY_LIST_NEEDS_282 = "Study list needs AI-Hydro tools >= 2.8.2."
export const CAPABILITIES_URI = "aihydro://capabilities"
export const STUDY_LIST_URI = "aihydro://study/list"
export const STUDY_BY_ARTIFACT_URI = "aihydro://study/by-artifact"
/** The server's own contract names (frozen by its contract tests), kept in one place. */
export const CHAT_STATUS_TOOL = "aihydro_chat_status"
export const REBIND_CHAT_TOOL = "aihydro_rebind_chat"
export const RESOLUTION_FAILED_CODE = "SESSION_RESOLUTION_FAILED"
/** Project registry (aihydro-tools >= 2.8.3, X1-P1). `ensure_project` is a host-audience tool: the host calls it, not the model. */
export const ENSURE_PROJECT_TOOL = "ensure_project"
export const PROJECT_URI = "aihydro://project"
export const PROJECT_HOST_OPS_CAP = "project.host_ops"
export const PROJECT_REGISTRY_CAP = "project.registry_v2"
/** Shown where a project is needed and the server is older than the registry. */
export const PROJECT_NEEDS_283 = "Projects need AI-Hydro tools >= 2.8.3. This chat has no project; update aihydro-tools."
const PROJECT_ID_RE = /^prj_[0-9A-Za-z]{26}$/
const CALL_TIMEOUT_MS = 15_000

export interface BindingHub {
	getServers(): McpServer[]
	readResource(serverName: string, uri: string): Promise<McpResourceResponse>
	callTool(
		serverName: string,
		toolName: string,
		toolArguments: Record<string, unknown> | undefined,
		ulid: string,
		meta?: Record<string, unknown>,
	): Promise<McpToolCallResponse>
}

/** What the launch knows about the study the chat is about. Any field may be absent. */
export interface LaunchStudyHint {
	/** The layer catalogue's study id (a layer pushed by a tool carries it). */
	sessionId?: string
	/** A workspace file the launch is about (a layer's source path). */
	artifactPath?: string
}

export interface ResolveLaunchInput {
	hub: BindingHub
	/** The chat id: the task ulid, the same value injected as the chat id on every tool call. */
	chatId: string
	workspace: string | undefined
	hint?: LaunchStudyHint
	/** The study the stored history item mirrored (a resume). */
	resumeStudyId?: string
	/** True when the chat is being resumed from history (a bound chat stays bound; no folder guess is made). */
	resuming?: boolean
	modelIdReturned?: string
	/** The chat's project (`prj_...`). When set, the studies offered and the "only study" rule are the project's. */
	projectId?: string
	/** Set to `aborted: true` by the caller when its budget ran out: no further write (rebind) is started. */
	abort?: { aborted: boolean }
}

function withTimeout<T>(p: Promise<T>, ms = CALL_TIMEOUT_MS): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`timed out after ${Math.round(ms / 1000)}s`)), ms)
	})
	return Promise.race([p, timeout]).finally(() => timer && clearTimeout(timer))
}

/** The trusted, connected first-party server. A server merely named like it is never asked to bind. */
export function findBindingServer(hub: BindingHub): McpServer | undefined {
	return hub
		.getServers()
		.find((s) => isAiHydroServerName(s.name) && s.status === "connected" && !s.disabled && isServerTrusted(s as any))
}

/** An enabled, connected first-party-named server that is not trusted: the launcher needs the user's confirmation. */
export function untrustedBindingServer(hub: BindingHub): McpServer | undefined {
	return hub
		.getServers()
		.find(
			(s) =>
				isAiHydroServerName(s.name) &&
				canOfferTrustAction(s.name) &&
				s.status === "connected" &&
				!s.disabled &&
				!isServerTrusted(s as any),
		)
}

function resourceJson(res: McpResourceResponse, uri: string): any {
	const item = (res?.contents ?? []).find((c: any) => typeof c?.text === "string")
	if (!item) {
		throw new Error(`no content for ${uri}`)
	}
	const parsed = JSON.parse((item as any).text)
	if (parsed && typeof parsed === "object" && parsed.error) {
		throw new Error(String(parsed.message ?? parsed.error))
	}
	return parsed
}

function toolJson(res: McpToolCallResponse): { json?: any; isError: boolean; text: string } {
	const text = (res?.content ?? [])
		.map((c: any) => (c?.type === "text" ? c.text : ""))
		.filter(Boolean)
		.join("\n")
	try {
		return { json: JSON.parse(text), isError: !!res?.isError, text }
	} catch {
		return { isError: !!res?.isError, text }
	}
}

/** A failed read that means "this server has no such resource" (an older server), as opposed to a transient failure. */
const RESOURCE_ABSENT = /unknown resource|resource not found|not found|method not found|-32002|-32601/i

/**
 * Capability flags, and whether the read itself failed. An older server (2.8.1) has no capabilities resource: that is
 * an empty set with `failed: false`. A timeout, a closed connection or any other error is `failed: true`, so a caller
 * can retry instead of taking a hiccup for "the flag is absent".
 */
export async function readCapabilitiesChecked(
	hub: BindingHub,
	server: McpServer,
): Promise<{ caps: Set<string>; failed: boolean }> {
	try {
		const body = resourceJson(await withTimeout(hub.readResource(server.name, CAPABILITIES_URI)), CAPABILITIES_URI)
		return {
			caps: new Set(
				Array.isArray(body?.capabilities) ? body.capabilities.filter((c: unknown) => typeof c === "string") : [],
			),
			failed: false,
		}
	} catch (error) {
		return { caps: new Set(), failed: !RESOURCE_ABSENT.test(error instanceof Error ? error.message : String(error)) }
	}
}

/** Capability flags the server advertises. An older server has no such resource: the answer is an empty set. */
export async function readCapabilities(hub: BindingHub, server: McpServer): Promise<Set<string>> {
	return (await readCapabilitiesChecked(hub, server)).caps
}

function toCandidate(row: any): StudyCandidateView | undefined {
	const id = row?.study_id
	if (typeof id !== "string" || !id) {
		return undefined
	}
	const label = typeof row.label === "string" && row.label.trim() ? row.label.trim() : `${id} (unnamed study)`
	return { studyId: id, label, ...(typeof row.last_run === "string" && row.last_run ? { lastRun: row.last_run } : {}) }
}

function toCandidates(rows: unknown): StudyCandidateView[] {
	return (Array.isArray(rows) ? rows : []).map(toCandidate).filter((c): c is StudyCandidateView => !!c)
}

/** Studies the server lists (labelled), optionally only those of a workspace. Throws when the resource is missing. */
export async function listStudies(hub: BindingHub, server: McpServer, workspace?: string): Promise<StudyCandidateView[]> {
	const uri = `${STUDY_LIST_URI}${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ""}`
	const body = resourceJson(await withTimeout(hub.readResource(server.name, uri)), uri)
	return toCandidates(body?.studies)
}

// ---- Projects (X1-P1) --------------------------------------------------------------------------------------

export type EnsureProjectResult =
	| { ok: true; projectId: string; title?: string; rootDir?: string; created: boolean }
	| { ok: false; code: "NO_SERVER" | "OLD_SERVER" | "FAILED"; reason: string }

/**
 * The project of a workspace folder, created by the server when there is none (it mints the `prj_` id; this client
 * never does). Idempotent on the server. Never throws: a server that is absent or older than 2.8.3 is a result with a
 * reason, and the caller carries on without a project.
 */
export async function ensureProject(
	hub: BindingHub,
	rootDir: string,
	ulid = "host",
	/** Pauses between attempts to read the server's capabilities (a transient failure is retried; test seam). */
	capabilityRetryDelaysMs: readonly number[] = [300, 900],
): Promise<EnsureProjectResult> {
	const server = findBindingServer(hub)
	if (!server) {
		return { ok: false, code: "NO_SERVER", reason: "The AI-Hydro server is not connected, so this chat has no project yet." }
	}
	try {
		let read = await readCapabilitiesChecked(hub, server)
		for (const delay of capabilityRetryDelaysMs) {
			if (!read.failed) {
				break
			}
			await new Promise((resolve) => setTimeout(resolve, delay))
			read = await readCapabilitiesChecked(hub, server)
		}
		if (read.failed) {
			// Not "the server is old": the read did not work. The caller retries later and says so.
			return {
				ok: false,
				code: "FAILED",
				reason: "Could not read the AI-Hydro server's capabilities, so this chat has no project yet.",
			}
		}
		if (!read.caps.has(PROJECT_HOST_OPS_CAP)) {
			return { ok: false, code: "OLD_SERVER", reason: PROJECT_NEEDS_283 }
		}
		const { json, isError, text } = toolJson(
			await withTimeout(hub.callTool(server.name, ENSURE_PROJECT_TOOL, { root_dir: rootDir }, ulid)),
		)
		if (isError || !json || json.error) {
			return {
				ok: false,
				code: "FAILED",
				reason: `Could not create the project: ${String(json?.message ?? text ?? "unknown error")}`,
			}
		}
		if (typeof json.project_id !== "string" || !PROJECT_ID_RE.test(json.project_id)) {
			return { ok: false, code: "FAILED", reason: "The server answered ensure_project without a valid project id." }
		}
		return {
			ok: true,
			projectId: json.project_id,
			created: json.status === "created",
			...(typeof json.title === "string" && json.title ? { title: json.title } : {}),
			...(typeof json.root_dir === "string" ? { rootDir: json.root_dir } : {}),
		}
	} catch (error) {
		return {
			ok: false,
			code: "FAILED",
			reason: `Could not create the project: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}

export interface ProjectStudies {
	title?: string
	studies: StudyCandidateView[]
}

/**
 * The studies a project holds, labelled by the server (never a bare id). Hidden studies (archived, test) and
 * studies whose files are gone are left out, the same as the folder list. Throws when the project is not found or the
 * server cannot say, so a caller can fall back to the folder.
 */
export async function projectStudies(hub: BindingHub, server: McpServer, projectId: string): Promise<ProjectStudies> {
	const uri = `${PROJECT_URI}/${encodeURIComponent(projectId)}`
	const body = resourceJson(await withTimeout(hub.readResource(server.name, uri)), uri)
	if (body?.found === false) {
		throw new Error(`project ${projectId} was not found`)
	}
	const rows = (Array.isArray(body?.studies) ? body.studies : []).filter((r: any) => !r?.hidden && r?.exists !== false)
	return { title: typeof body?.title === "string" && body.title ? body.title : undefined, studies: toCandidates(rows) }
}

export interface ArtifactOwner {
	resolved: boolean
	studyId?: string
	candidates: StudyCandidateView[]
}

export async function studyByArtifact(
	hub: BindingHub,
	server: McpServer,
	path: string,
	workspace?: string,
): Promise<ArtifactOwner> {
	const uri = `${STUDY_BY_ARTIFACT_URI}?path=${encodeURIComponent(path)}${workspace ? `&workspace=${encodeURIComponent(workspace)}` : ""}`
	const body = resourceJson(await withTimeout(hub.readResource(server.name, uri)), uri)
	const candidates = toCandidates(body?.candidates)
	// Only the manifest rule resolves; a heuristic answer is candidates only and is never taken as the owner.
	const resolved = body?.resolved === true && typeof body?.study_id === "string"
	return { resolved, studyId: resolved ? body.study_id : undefined, candidates }
}

export interface ChatStatus {
	bound: boolean
	studyId?: string
}

/** The chat's current binding, from the server (the same channel the answer audit uses). `undefined` = unknown. */
export async function chatStatus(
	hub: BindingHub,
	server: McpServer,
	chatId: string,
	workspace: string | undefined,
	modelIdReturned?: string,
	projectId?: string,
): Promise<ChatStatus | undefined> {
	try {
		if (server.tools && server.tools.length > 0 && !server.tools.some((t) => t.name === CHAT_STATUS_TOOL)) {
			return undefined
		}
		const ctx = buildAiHydroCallContext({ chat_id: chatId }, chatId, workspace, modelIdReturned, projectId)
		const { json, isError } = toolJson(
			await withTimeout(hub.callTool(server.name, CHAT_STATUS_TOOL, ctx.args, chatId, ctx.meta)),
		)
		if (isError || !json || typeof json.bound !== "boolean") {
			return undefined
		}
		return json.bound && typeof json.study_id === "string" ? { bound: true, studyId: json.study_id } : { bound: false }
	} catch {
		return undefined
	}
}

export type RebindResult = { ok: true; studyId: string } | { ok: false; code: string; message: string }

/** Bind the chat to an existing study. The server confirms the study exists; it never creates one here. */
export async function rebindChat(
	hub: BindingHub,
	server: McpServer,
	chatId: string,
	studyId: string,
	workspace: string | undefined,
	modelIdReturned?: string,
	projectId?: string,
): Promise<RebindResult> {
	try {
		// The chat id is passed explicitly as well as injected: an older server (no chat-id default) needs it, and a
		// current one requires it to equal the injected id.
		const ctx = buildAiHydroCallContext({ study_id: studyId, chat_id: chatId }, chatId, workspace, modelIdReturned, projectId)
		const { json, isError, text } = toolJson(
			await withTimeout(hub.callTool(server.name, REBIND_CHAT_TOOL, ctx.args, chatId, ctx.meta)),
		)
		if (isError || !json || json.error) {
			return {
				ok: false,
				code: String(json?.code ?? "REBIND_FAILED"),
				message: String(json?.message ?? text ?? "rebind failed"),
			}
		}
		const bound =
			typeof json.study_id === "string" ? json.study_id : typeof json.bound_to === "string" ? json.bound_to : studyId
		return { ok: true, studyId: bound }
	} catch (error) {
		return { ok: false, code: "REBIND_FAILED", message: error instanceof Error ? error.message : String(error) }
	}
}

function labelFor(id: string, candidates: StudyCandidateView[]): string | undefined {
	return candidates.find((c) => c.studyId === id)?.label
}

/**
 * Decide the binding for a chat that is starting (or resuming), and bind it when the evidence names exactly one
 * study. Order, first that applies:
 *   1. a resumed chat already bound on the server stays bound;
 *   2. the launch's own study (layer catalogue id, then the artifact manifest) or the stored mirror;
 *   3. the only study of the workspace;
 *   4. several candidates: `choose` (nothing is bound); no study: `none`.
 * Never throws: any failure is `unavailable` with the reason.
 */
export async function resolveLaunchBinding(input: ResolveLaunchInput): Promise<StudyBindingState> {
	const { hub, chatId, workspace } = input
	const unavailable = (reason: string, canChoose = false): StudyBindingState => ({
		chatId,
		status: "unavailable",
		reason,
		canChoose,
	})
	const server = findBindingServer(hub)
	if (!server) {
		// Connected but not trusted is a different problem from not connected, and the user can fix it.
		const untrusted = untrustedBindingServer(hub)
		if (untrusted) {
			return {
				...unavailable(
					`${newLauncherSentence(launchLineOfConfig(untrusted.config))} Studies cannot be bound until you confirm it.`,
				),
				cause: "untrusted_server",
			}
		}
		return unavailable("The AI-Hydro server is not connected, so studies cannot be bound yet.")
	}
	try {
		const caps = await readCapabilities(hub, server)
		const canList = caps.has("study.list")
		const canChoose = canList && caps.has("binding.v2")
		let known: StudyCandidateView[] = []
		// The chat's project lists its studies; a server or project that cannot say falls back to the folder.
		let scope = "folder"
		if (input.projectId && caps.has(PROJECT_REGISTRY_CAP)) {
			try {
				known = (await projectStudies(hub, server, input.projectId)).studies
				scope = "project"
			} catch {
				known = []
			}
		}
		if (canList && scope === "folder") {
			try {
				known = await listStudies(hub, server, workspace)
			} catch {
				known = []
			}
		}
		const bound = (studyId: string, by: StudyBindingState["by"], reason: string, pool = known): StudyBindingState => ({
			chatId,
			status: "bound",
			studyId,
			label: labelFor(studyId, pool),
			reason,
			by,
			canChoose,
		})

		// 1. A resumed chat that the server still has bound.
		if (input.resuming) {
			const status = await chatStatus(hub, server, chatId, workspace, input.modelIdReturned, input.projectId)
			if (status?.bound && status.studyId) {
				return bound(
					status.studyId,
					"resume",
					"Resumed with its study.",
					await labelPool(hub, server, status.studyId, known, canList),
				)
			}
		}

		// 2. Evidence the launch carries.
		const tried = new Set<string>()
		/** Why a study the launch named could not be bound (hidden, missing), shown with the picker or chip. */
		const notes: string[] = []
		const withNotes = (state: StudyBindingState): StudyBindingState =>
			notes.length > 0 ? { ...state, reason: [state.reason, ...notes].filter(Boolean).join(" ") } : state
		const tryBind = async (studyId: string, by: StudyBindingState["by"], reason: string) => {
			if (tried.has(studyId) || input.abort?.aborted) {
				return undefined
			}
			tried.add(studyId)
			const r = await rebindChat(hub, server, chatId, studyId, workspace, input.modelIdReturned, input.projectId)
			if (!r.ok) {
				notes.push(`Study '${studyId}' was not bound: ${r.message}`)
				return undefined
			}
			return bound(r.studyId, by, reason, await labelPool(hub, server, r.studyId, known, canList))
		}
		if (input.hint?.sessionId) {
			const r = await tryBind(input.hint.sessionId, "map-layer", "The map layer belongs to this study.")
			if (r) {
				return r
			}
		}
		let artifactCandidates: StudyCandidateView[] = []
		if (input.hint?.artifactPath && caps.has("study.by_artifact")) {
			try {
				const owner = await studyByArtifact(hub, server, input.hint.artifactPath, workspace)
				if (owner.resolved && owner.studyId) {
					const r = await tryBind(owner.studyId, "map-artifact", "The file was written by this study.")
					if (r) {
						return r
					}
				}
				artifactCandidates = owner.candidates
			} catch {
				artifactCandidates = []
			}
		}
		if (input.resumeStudyId) {
			const r = await tryBind(input.resumeStudyId, "resume", "Resumed with its study.")
			if (r) {
				return r
			}
		}
		if (artifactCandidates.length > 0) {
			return withNotes({
				chatId,
				status: "choose",
				candidates: artifactCandidates,
				reason: "More than one study could own this file. Pick one.",
				canChoose,
			})
		}

		// 3 and 4. The folder.
		if (!canList) {
			return withNotes(unavailable(STUDY_LIST_NEEDS_282))
		}
		if (known.length === 1) {
			const r = await tryBind(known[0].studyId, "workspace", `The only study in this ${scope}.`)
			if (r) {
				return r
			}
		}
		if (known.length > 1) {
			return withNotes({
				chatId,
				status: "choose",
				candidates: known,
				reason: `${known.length} studies in this ${scope}. Pick one before the first run.`,
				canChoose,
			})
		}
		return withNotes({
			chatId,
			status: "none",
			reason: `No study in this ${scope} yet. Delineating a watershed creates one.`,
			canChoose,
		})
	} catch (error) {
		return unavailable(error instanceof Error ? error.message : String(error))
	}
}

/** Candidates labelled for `studyId`: reuse the folder list when it holds it, else ask for the full list once. */
async function labelPool(
	hub: BindingHub,
	server: McpServer,
	studyId: string,
	known: StudyCandidateView[],
	canList: boolean,
): Promise<StudyCandidateView[]> {
	if (known.some((c) => c.studyId === studyId) || !canList) {
		return known
	}
	try {
		return await listStudies(hub, server)
	} catch {
		return known
	}
}

/** The shape of a server result's `session_binding` field (aihydro-tools >= 2.8.2). */
export interface SessionBindingField {
	chatId: string
	studyId: string
	label?: string
	previousStudyId?: string
	boundBy?: string
}

/** What a tool result tells the host about the binding, with no tool-name knowledge: a field or an error code. */
export type BindingSignal =
	| { kind: "binding"; binding: SessionBindingField }
	/** The call tried to bind the chat and the server declined (`session_binding_skipped`): shown, never acted on. */
	| { kind: "skipped"; message: string }
	| { kind: "unresolved"; candidates: StudyCandidateView[]; message?: string }

/**
 * A result's JSON body. The transport may wrap a structured error in prose ("Error:\n...", "Error calling tool: {...}"),
 * so when the whole text is not JSON the outermost braces are tried; anything else is no envelope at all.
 */
function parseEnvelope(text: string): any {
	const body = text.replace(/^Error:\n/, "")
	try {
		return JSON.parse(body)
	} catch {
		const open = body.indexOf("{")
		const close = body.lastIndexOf("}")
		if (open >= 0 && close > open) {
			try {
				return JSON.parse(body.slice(open, close + 1))
			} catch {
				return undefined
			}
		}
		return undefined
	}
}

export function parseBindingSignal(resultText: string): BindingSignal | undefined {
	if (!resultText || (!resultText.includes("session_binding") && !resultText.includes(RESOLUTION_FAILED_CODE))) {
		return undefined
	}
	const json = parseEnvelope(resultText)
	if (!json) {
		return undefined
	}
	const sb = json?.session_binding
	if (sb && typeof sb === "object" && typeof sb.study_id === "string" && typeof sb.chat_id === "string") {
		return {
			kind: "binding",
			binding: {
				chatId: sb.chat_id,
				studyId: sb.study_id,
				...(typeof sb.label === "string" && sb.label ? { label: sb.label } : {}),
				...(typeof sb.previous_study_id === "string" ? { previousStudyId: sb.previous_study_id } : {}),
				...(typeof sb.bound_by === "string" ? { boundBy: sb.bound_by } : {}),
			},
		}
	}
	if (typeof json?.session_binding_skipped === "string" && json.session_binding_skipped) {
		return { kind: "skipped", message: json.session_binding_skipped }
	}
	if (json?.error && json?.code === RESOLUTION_FAILED_CODE) {
		return {
			kind: "unresolved",
			candidates: toCandidates(json.candidates),
			...(typeof json.message === "string" ? { message: json.message } : {}),
		}
	}
	return undefined
}

/**
 * The picker's candidates when the user opens it from the chip: the workspace's studies, else every visible one.
 * An empty list is a real answer (nothing to pick).
 */
export async function candidatesForPicker(
	hub: BindingHub,
	workspace: string | undefined,
	projectId?: string,
): Promise<StudyCandidateView[]> {
	const server = findBindingServer(hub)
	if (!server) {
		throw new Error("The AI-Hydro server is not connected.")
	}
	if (projectId) {
		try {
			const inProject = (await projectStudies(hub, server, projectId)).studies
			if (inProject.length > 0) {
				return inProject
			}
		} catch {
			// The project cannot be read: the folder's studies are the next best list.
		}
		// A project with no studies yet offers the folder's, then every visible one (below), as before.
	}
	const here = workspace ? await listStudies(hub, server, workspace) : []
	return here.length > 0 ? here : await listStudies(hub, server)
}
