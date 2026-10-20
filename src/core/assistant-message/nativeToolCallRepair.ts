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
 *  - values are inert: a parameter value that could open/close a protocol element is refused (built-in tools) or
 *    JSON-escaped (MCP arguments), so one envelope can never smuggle in a second tool call;
 *  - only a TRAILING envelope is converted, and the host enables this only for model families that emit native
 *    tool calls; envelopes in prose, quotes, indented or fenced code are documentation;
 *  - an envelope still streaming is hidden from the transcript, and conversion happens once the message completes.
 */
import { toolUseNames } from "@shared/tools"
import { isDeepSeekModelFamily } from "@utils/model-utils"
import { toolParamNames } from "."

export interface NativeToolCallContext {
	/** Connected MCP servers and the tools each exposes (with optional JSON input schema for argument typing). */
	servers: Array<{ name: string; trusted?: boolean; tools: Array<{ name: string; inputSchema?: unknown }> }>
}

export interface NativeToolCallRepairResult {
	/** Text to feed the normal parser (repaired envelopes rewritten, malformed/in-flight ones removed). */
	text: string
	/** Number of envelopes rewritten into protocol XML. */
	repaired: number
	/** Raw text of envelopes that could not be converted (final pass only; in-flight envelopes are hidden, not reported). */
	malformed: string[]
	/** Where each repaired call was routed (final pass), for the one muted line shown to the user. */
	routes: Array<{ server?: string; tool: string }>
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
	// Blockquote or indented code: quoted/illustrative, not a call.
	if (/^(?:\s{0,3}>|\t| {4})/.test(text.slice(lineStart, index + 1))) {
		return true
	}
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

const PROTOCOL_TAG_RE = new RegExp(
	`</|<\\s*(?:${[...toolUseNames, ...toolParamNames, "tool_calls", "invoke", "parameter"].join("|")})\\b`,
	"i",
)
const SAFE_NAME_RE = /^[A-Za-z0-9_.:-]+$/

/** A raw (XML-spliced) value must not be able to open or close any protocol element. */
const isInertValue = (v: string): boolean => !PROTOCOL_TAG_RE.test(v)

function toProtocolXml(
	invokes: Array<{ name: string; params: Array<[string, string]> }>,
	ctx: NativeToolCallContext,
	routes: Array<{ server?: string; tool: string }>,
): string | undefined {
	const blocks: string[] = []
	for (const { name, params } of invokes) {
		if (BUILTIN.has(name)) {
			// Built-in params are spliced into XML verbatim, so a value that could open/close a protocol element is refused.
			if (params.some(([k, v]) => !KNOWN_PARAMS.has(k) || !isInertValue(v))) {
				return undefined
			}
			blocks.push(`<${name}>\n${params.map(([k, v]) => `<${k}>${v}</${k}>`).join("\n")}\n</${name}>`)
			routes.push({ tool: name })
			continue
		}
		if (!SAFE_NAME_RE.test(name)) {
			return undefined
		}
		let owners = ctx.servers.filter((s) => s.tools.some((t) => t.name === name))
		if (owners.length > 1) {
			// Prefer the single trusted server; otherwise it is ambiguous and never guessed.
			const trusted = owners.filter((s) => s.trusted)
			owners = trusted.length === 1 ? trusted : owners
		}
		if (owners.length !== 1 || !SAFE_NAME_RE.test(owners[0].name)) {
			return undefined // unknown, or ambiguous across servers: never guess
		}
		const tool = owners[0].tools.find((t) => t.name === name)!
		const props = (tool.inputSchema as any)?.properties ?? {}
		const args: Record<string, unknown> = {}
		for (const [k, v] of params) {
			args[k] = coerce(v, props[k])
		}
		// `<` is escaped as \u003c so the JSON round-trips as data but can never form a protocol tag in the XML text.
		const json = JSON.stringify(args).replace(/</g, "\\u003c")
		blocks.push(
			`<use_mcp_tool>\n<server_name>${owners[0].name}</server_name>\n<tool_name>${name}</tool_name>\n<arguments>\n${json}\n</arguments>\n</use_mcp_tool>`,
		)
		routes.push({ server: owners[0].name, tool: name })
	}
	return blocks.join("\n")
}

/**
 * @param final false while streaming: every envelope (closed or not) is HIDDEN and nothing is converted, so a
 *              tool never starts from a half-seen message. true once the message is complete: only an envelope that
 *              is the TRAILING element of the message is converted; an unterminated or unparseable one is reported
 *              as malformed; anything else (quoted, indented, followed by more text) is left as ordinary text.
 */
export function repairNativeToolCalls(text: string, ctx: NativeToolCallContext, final: boolean): NativeToolCallRepairResult {
	const none = { text, repaired: 0, malformed: [] as string[], routes: [] as Array<{ server?: string; tool: string }> }
	if (!text.includes(OPEN)) {
		return none
	}
	let out = ""
	let cursor = 0
	let repaired = 0
	const malformed: string[] = []
	const routes: Array<{ server?: string; tool: string }> = []
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
			if (!final) {
				cursor = text.length // still streaming: hide it
				break
			}
			// Unterminated: hide only the envelope itself (through its last complete invoke/parameter), keep the rest.
			const tail = text.slice(start)
			const lastClose = Math.max(tail.lastIndexOf("</invoke>"), tail.lastIndexOf("</parameter>"))
			const extentEnd = lastClose === -1 ? OPEN.length : lastClose + (tail.startsWith("</invoke>", lastClose) ? 9 : 12)
			malformed.push(tail.slice(0, extentEnd).trim())
			cursor = start + extentEnd
			continue
		}
		const afterEnvelope = end + CLOSE.length
		const raw = text.slice(start, afterEnvelope)
		if (!final) {
			cursor = afterEnvelope // hidden until the message is complete
			continue
		}
		if (text.slice(afterEnvelope).trim() !== "") {
			// Not the trailing element: prose that mentions an envelope, not a call. Leave it as it is.
			out += raw
			cursor = afterEnvelope
			continue
		}
		const invokes = parseInvokes(text.slice(start + OPEN.length, end))
		const xml = invokes ? toProtocolXml(invokes, ctx, routes) : undefined
		if (xml) {
			out += xml
			repaired++
		} else {
			malformed.push(raw)
		}
		cursor = afterEnvelope
	}
	return { text: out, repaired, malformed, routes }
}

/**
 * Model-gated entry point used by the task loop: only families that emit native `<tool_calls>` text (DeepSeek) are
 * repaired. For any other model the text is returned untouched, so an envelope there is ordinary prose.
 */
export function repairNativeToolCallsForModel(
	modelId: string,
	text: string,
	ctx: NativeToolCallContext,
	final: boolean,
): NativeToolCallRepairResult {
	if (!isDeepSeekModelFamily(modelId)) {
		return { text, repaired: 0, malformed: [], routes: [] }
	}
	return repairNativeToolCalls(text, ctx, final)
}
