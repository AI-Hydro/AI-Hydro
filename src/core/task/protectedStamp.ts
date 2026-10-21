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

/**
 * Argument names that carry a file or directory, matched as a case-insensitive SUFFIX so camelCase and snake_case both
 * hit (outputPath, target_path, outDir, destFile, uri). Generic shapes only: no tool names. Detection of MCP paths is
 * heuristic by nature and can only over-lift.
 */
const PATH_KEY = /(path|file|filename|dir|directory|dest|destination|output|out|src|source|folder|target|location|uri|to)s?$/i
/** Values that look like a path whatever their key: absolute, `~`, or a `file://` URI. */
const LOOKS_LIKE_PATH = /^(~(?:[\\/]|$)|\/|[A-Za-z]:[\\/]|\\\\|file:\/\/)/i
/** Visiting budget: past it the call counts as uninspected and is stamped (over-lift), never skipped. */
const NODE_BUDGET = 5000

function asFsPath(value: string): string {
	if (/^file:\/\//i.test(value)) {
		let p = value.replace(/^file:\/\//i, "")
		try {
			p = decodeURIComponent(p)
		} catch {
			// keep the raw text
		}
		// file:///C:/x -> C:/x ; file:///home/u -> /home/u ; file://host/share is left as-is
		return /^\/[A-Za-z]:[\\/]/.test(p) ? p.slice(1) : p
	}
	return value
}

interface Collected {
	paths: string[]
	uninspected: boolean
}

function collectPaths(root: unknown): Collected {
	const out: Collected = { paths: [], uninspected: false }
	let nodes = 0
	// Iterative so a deeply nested argument tree cannot overflow the stack; `ctx` is true under a path-like key.
	const stack: Array<{ value: unknown; ctx: boolean }> = [{ value: root, ctx: false }]
	while (stack.length) {
		const { value, ctx } = stack.pop() as { value: unknown; ctx: boolean }
		if (++nodes > NODE_BUDGET) {
			out.uninspected = true
			break
		}
		if (typeof value === "string") {
			if (value.trim() !== "" && (ctx || LOOKS_LIKE_PATH.test(value))) {
				out.paths.push(asFsPath(value))
			}
		} else if (Array.isArray(value)) {
			for (const v of value) {
				stack.push({ value: v, ctx })
			}
		} else if (value && typeof value === "object") {
			for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
				stack.push({ value: v, ctx: ctx || PATH_KEY.test(k) })
			}
		}
	}
	return out
}

function parse(text: string | undefined): unknown {
	try {
		return JSON.parse(text ?? "")
	} catch {
		return undefined
	}
}

/** Every path a tool row (native file tool or MCP call) names; `uninspected` when the argument tree was too big to walk. */
export function pathsNamedBy(message: AiHydroMessage): Collected {
	const none: Collected = { paths: [], uninspected: false }
	const kind = message.type === "ask" ? message.ask : message.say
	if (kind !== "tool" && kind !== "use_mcp_server") {
		return none
	}
	const body = parse(message.text) as Record<string, unknown> | undefined
	if (!body || typeof body !== "object") {
		return none
	}
	if (kind === "tool") {
		const paths = ["path", "filePath"].flatMap((k) =>
			typeof body[k] === "string" && (body[k] as string).trim() !== "" ? [body[k] as string] : [],
		)
		return { paths, uninspected: false }
	}
	const args = typeof body.arguments === "string" ? parse(body.arguments) : body.arguments
	return collectPaths(args)
}

export function touchesProtectedPath(message: AiHydroMessage, roots: readonly string[], bases: readonly string[]): boolean {
	const named = pathsNamedBy(message)
	if (named.uninspected) {
		return true
	}
	return named.paths.some((raw) => {
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
