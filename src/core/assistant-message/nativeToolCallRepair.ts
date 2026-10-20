/**
 * Parser repair for DeepSeek-style "native" tool-call text.
 *
 * Open models sometimes ignore the XML tool protocol and emit their own envelope as plain assistant text:
 *
 *   <tool_calls>
 *   <invoke name="delineate_watershed">
 *   <parameter name="gauge_id">01031500</parameter>
 *   </invoke>
 *   </tool_calls>
 *
 * Left alone, that is shown as a stray chat bubble and the call never runs (one wasted retry). This module
 * rewrites each well-formed envelope into the protocol's own XML (`<use_mcp_tool>` for a tool that exactly one
 * connected MCP server exposes, or the built-in tool's tag), so the normal parser, approval flow and handlers
 * run unchanged. Principles, mirroring ToolInputRepair:
 *  - never guess: an unknown or ambiguous tool name, or a built-in tool given parameters it does not take, is
 *    reported as malformed (never executed);
 *  - text inside code fences / inline code is documentation, not a call, and is left untouched;
 *  - an envelope still streaming (no closing tag yet) is hidden from the transcript until it completes.
 */
import { toolUseNames } from "@shared/tools"
import { toolParamNames } from "."

export interface NativeToolCallContext {
	/** Connected MCP servers and the tools each exposes (with optional JSON input schema for argument typing). */
	servers: Array<{ name: string; tools: Array<{ name: string; inputSchema?: unknown }> }>
}

export interface NativeToolCallRepairResult {
	/** Text to feed the normal parser (repaired envelopes rewritten, malformed/in-flight ones removed). */
	text: string
	/** Number of envelopes rewritten into protocol XML. */
	repaired: number
	/** Raw text of envelopes that could not be converted (final pass only; in-flight envelopes are hidden, not reported). */
	malformed: string[]
}

const OPEN = "<tool_calls>"
const CLOSE = "</tool_calls>"
const INVOKE_RE = /<invoke\s+name\s*=\s*"([^"]+)"\s*>([\s\S]*?)<\/invoke>/g
const PARAM_RE = /<parameter\s+name\s*=\s*"([^"]+)"\s*>([\s\S]*?)<\/parameter>/g

const BUILTIN = new Set<string>(toolUseNames as string[])
const KNOWN_PARAMS = new Set<string>(toolParamNames as readonly string[])

/** True when `index` sits inside a fenced code block or an inline code span on its line. */
function insideCode(text: string, index: number): boolean {
	const before = text.slice(0, index)
	const fences = before.match(/^\s*(```|~~~)/gm)
	if (fences && fences.length % 2 === 1) {
		return true
	}
	const lineStart = before.lastIndexOf("\n") + 1
	const ticks = before.slice(lineStart).split("`").length - 1
	return ticks % 2 === 1
}

function coerce(value: string, schema: any): unknown {
	const type = schema?.type
	const types: string[] = Array.isArray(type) ? type : type ? [type] : []
	if (types.length === 0 || types.includes("string")) {
		return value
	}
	const v = value.trim()
	if ((types.includes("integer") || types.includes("number")) && v !== "" && Number.isFinite(Number(v))) {
		return Number(v)
	}
	if (types.includes("boolean") && (v === "true" || v === "false")) {
		return v === "true"
	}
	if (types.includes("object") || types.includes("array")) {
		try {
			return JSON.parse(v)
		} catch {
			return value
		}
	}
	return value
}

function parseInvokes(body: string): Array<{ name: string; params: Array<[string, string]> }> | undefined {
	const invokes: Array<{ name: string; params: Array<[string, string]> }> = []
	let consumed = body.replace(INVOKE_RE, (_m, name: string, inner: string) => {
		const params: Array<[string, string]> = []
		const rest = inner.replace(PARAM_RE, (_p, k: string, v: string) => {
			params.push([k, v])
			return ""
		})
		if (rest.trim() !== "") {
			// stray content inside the invoke: not the shape we understand
			invokes.push({ name: "", params: [] })
		} else {
			invokes.push({ name, params })
		}
		return ""
	})
	consumed = consumed.trim()
	if (consumed !== "" || invokes.length === 0 || invokes.some((i) => !i.name)) {
		return undefined
	}
	return invokes
}

function toProtocolXml(
	invokes: Array<{ name: string; params: Array<[string, string]> }>,
	ctx: NativeToolCallContext,
): string | undefined {
	const blocks: string[] = []
	for (const { name, params } of invokes) {
		if (BUILTIN.has(name)) {
			if (params.some(([k]) => !KNOWN_PARAMS.has(k))) {
				return undefined
			}
			blocks.push(`<${name}>\n${params.map(([k, v]) => `<${k}>${v}</${k}>`).join("\n")}\n</${name}>`)
			continue
		}
		const owners = ctx.servers.filter((s) => s.tools.some((t) => t.name === name))
		if (owners.length !== 1) {
			return undefined // unknown, or ambiguous across servers: never guess
		}
		const tool = owners[0].tools.find((t) => t.name === name)!
		const props = (tool.inputSchema as any)?.properties ?? {}
		const args: Record<string, unknown> = {}
		for (const [k, v] of params) {
			args[k] = coerce(v, props[k])
		}
		blocks.push(
			`<use_mcp_tool>\n<server_name>${owners[0].name}</server_name>\n<tool_name>${name}</tool_name>\n<arguments>\n${JSON.stringify(args)}\n</arguments>\n</use_mcp_tool>`,
		)
	}
	return blocks.join("\n")
}

/**
 * @param final false while streaming (an unterminated envelope is hidden), true once the message is complete
 *              (an unterminated or unparseable envelope is reported as malformed).
 */
export function repairNativeToolCalls(text: string, ctx: NativeToolCallContext, final: boolean): NativeToolCallRepairResult {
	if (!text.includes(OPEN)) {
		return { text, repaired: 0, malformed: [] }
	}
	let out = ""
	let cursor = 0
	let repaired = 0
	const malformed: string[] = []
	while (cursor < text.length) {
		const start = text.indexOf(OPEN, cursor)
		if (start === -1) {
			out += text.slice(cursor)
			break
		}
		if (insideCode(text, start)) {
			out += text.slice(cursor, start + OPEN.length)
			cursor = start + OPEN.length
			continue
		}
		out += text.slice(cursor, start)
		const end = text.indexOf(CLOSE, start + OPEN.length)
		if (end === -1) {
			// still streaming (or never closed): hide it; report only on the final pass
			if (final) {
				malformed.push(text.slice(start).trim())
			}
			cursor = text.length
			break
		}
		const raw = text.slice(start, end + CLOSE.length)
		const invokes = parseInvokes(text.slice(start + OPEN.length, end))
		const xml = invokes ? toProtocolXml(invokes, ctx) : undefined
		if (xml) {
			out += xml
			repaired++
		} else if (final) {
			malformed.push(raw)
		}
		cursor = end + CLOSE.length
	}
	return { text: out, repaired, malformed }
}
