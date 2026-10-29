import type { McpResourceResponse, McpServer } from "@shared/mcp"
import { createHash } from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import { findBindingServer } from "@/integrations/aihydro-session/studyBinding"

/**
 * The one place the host decides what a project is called (UX program 2026-11, section 1.1).
 *
 * `prj_...` once the tools server's project registry knows the directory; until then (no server, an older
 * server, no project record yet, any error) `dir:<sha256(realpath)>`, the same value the server's
 * `ai_hydro/session/project_key.py` computes. Callers treat `key` as opaque and use `kind` only to decide
 * whether a later `dir:` -> `prj_` migration is still due (X1-P1).
 *
 * Reading never creates: a directory with no project record keeps its `dir:` key; creating the record is
 * `ensure_project`, which belongs to the project flow, not to a key lookup.
 */

export type ProjectKeyKind = "prj" | "dir"
export interface ProjectKey {
	key: string
	kind: ProjectKeyKind
}

export const PROJECT_BY_DIR_URI = "aihydro://project/by-dir"
const PRJ_ID = /^prj_[0-9A-Za-z]+$/
const LOOKUP_TIMEOUT_MS = 5_000

/** What the key lookup needs from the MCP hub (a subset of the binding hub). */
export interface ProjectKeyHub {
	getServers(): McpServer[]
	readResource(serverName: string, uri: string): Promise<McpResourceResponse>
}

/**
 * `os.path.realpath` semantics: symlinks in the part of the path that exists are resolved, the rest is kept
 * as written, and the result is absolute with no trailing separator.
 */
async function realpathLoose(p: string): Promise<string> {
	const abs = path.resolve(p)
	try {
		return await fs.realpath(abs)
	} catch {
		const parent = path.dirname(abs)
		if (parent === abs) {
			return abs
		}
		return path.join(await realpathLoose(parent), path.basename(abs))
	}
}

/** `dir:<sha256(realpath(rootDir))>`, byte for byte the server's `project_key(rootDir)`. */
export async function dirProjectKey(rootDir: string): Promise<string> {
	return (
		"dir:" +
		createHash("sha256")
			.update(await realpathLoose(rootDir), "utf8")
			.digest("hex")
	)
}

async function lookupProjectId(hub: ProjectKeyHub, resolvedDir: string): Promise<string | undefined> {
	const server = findBindingServer(hub as Parameters<typeof findBindingServer>[0])
	if (!server) {
		return undefined
	}
	const uri = `${PROJECT_BY_DIR_URI}?path=${encodeURIComponent(resolvedDir)}`
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		const res = await Promise.race([
			hub.readResource(server.name, uri),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error("project lookup timed out")), LOOKUP_TIMEOUT_MS)
			}),
		])
		const text = (res?.contents ?? []).find((c: any) => typeof c?.text === "string") as { text: string } | undefined
		const body = text ? JSON.parse(text.text) : undefined
		const id = body?.found === true ? body.project_id : undefined
		return typeof id === "string" && PRJ_ID.test(id) ? id : undefined
	} catch {
		return undefined
	} finally {
		if (timer) {
			clearTimeout(timer)
		}
	}
}

/**
 * The project key of a workspace directory. Pass the MCP hub to let the tools server answer with its
 * `prj_...` id; without one (or when it cannot) the answer is the `dir:` key.
 */
export async function getProjectKey(rootDir: string, hub?: ProjectKeyHub): Promise<ProjectKey> {
	if (hub) {
		const id = await lookupProjectId(hub, await realpathLoose(rootDir))
		if (id) {
			return { key: id, kind: "prj" }
		}
	}
	return { key: await dirProjectKey(rootDir), kind: "dir" }
}
