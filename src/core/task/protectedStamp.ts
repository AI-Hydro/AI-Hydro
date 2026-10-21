/**
 * Host-side "protected path" stamp for tool rows (Wave 2, W2-A2).
 *
 * The transcript lifts an approval that touched protected state. The authoritative test is `isProtectedPath`
 * (symlink-resolving, case-aware, real filesystem), which only the host can run. So the host stamps the row
 * (`policyClass: "protected_path"`, the same field commands already use) when that test is true for any path the call
 * names, and the presenter lifts on the stamp. The webview's string matcher (protectedPathMatch.ts) is a best-effort
 * extra over-lift for display and is never the authority.
 *
 * A relative path is tried against every base (task cwd and workspace roots), so no base makes a protected target
 * look safe; `~` is expanded.
 */
import * as os from "os"
import * as path from "path"
import type { AiHydroMessage } from "@/shared/ExtensionMessage"
import { isProtectedPath } from "./protectedPaths"

/** Argument names that carry a file or directory. Generic shapes only: no tool names. */
const PATH_KEY = /(^|[_-])(path|file|filepath|filename|dir|directory|dest|destination|output|out|src|source|folder)s?$/i

function collectPaths(value: unknown, key: string | undefined, out: string[], depth = 0): void {
	if (depth > 6 || value === null || value === undefined) {
		return
	}
	if (typeof value === "string") {
		if (key !== undefined && PATH_KEY.test(key) && value.trim() !== "") {
			out.push(value)
		}
		return
	}
	if (Array.isArray(value)) {
		for (const v of value) {
			collectPaths(v, key, out, depth + 1)
		}
		return
	}
	if (typeof value === "object") {
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			collectPaths(v, k, out, depth + 1)
		}
	}
}

function parse(text: string | undefined): unknown {
	try {
		return JSON.parse(text ?? "")
	} catch {
		return undefined
	}
}

/** Every path a tool row (native file tool or MCP call) names. */
export function pathsNamedBy(message: AiHydroMessage): string[] {
	const kind = message.type === "ask" ? message.ask : message.say
	if (kind !== "tool" && kind !== "use_mcp_server") {
		return []
	}
	const body = parse(message.text) as Record<string, unknown> | undefined
	if (!body || typeof body !== "object") {
		return []
	}
	const out: string[] = []
	if (kind === "tool") {
		for (const k of ["path", "filePath"]) {
			if (typeof body[k] === "string" && (body[k] as string).trim() !== "") {
				out.push(body[k] as string)
			}
		}
		return out
	}
	const args = typeof body.arguments === "string" ? parse(body.arguments) : body.arguments
	collectPaths(args, undefined, out)
	return out
}

export function touchesProtectedPath(message: AiHydroMessage, roots: readonly string[], bases: readonly string[]): boolean {
	return pathsNamedBy(message).some((raw) => {
		const expanded =
			raw === "~" || raw.startsWith("~/") || raw.startsWith("~\\") ? path.join(os.homedir(), raw.slice(1)) : raw
		if (path.isAbsolute(expanded)) {
			return isProtectedPath(expanded, roots)
		}
		return bases.some((base) => isProtectedPath(path.resolve(base, expanded), roots))
	})
}

/** Stamps the unstamped tool rows among the last `window` messages. Returns how many were stamped. */
export function stampProtectedPaths(
	messages: AiHydroMessage[],
	roots: readonly string[],
	bases: readonly string[],
	window = 6,
): number {
	let stamped = 0
	for (const m of messages.slice(-window)) {
		if (!m.policyClass && touchesProtectedPath(m, roots, bases)) {
			m.policyClass = "protected_path"
			stamped++
		}
	}
	return stamped
}
