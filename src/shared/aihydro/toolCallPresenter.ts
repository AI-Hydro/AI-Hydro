/**
 * Pure presenter for AI-Hydro science tool calls (UI-W slice S3).
 *
 * Maps one MCP tool call (server, tool, arguments JSON, result text, optional tool metadata) to a display
 * model. It is generic: it never branches on a tool name. Every field is read from an explicit key of the
 * server's own result or error envelope, and a field the server did not send stays `undefined`, which the
 * card renders as "not reported". Nothing is inferred (not the information class, not a source from a
 * product name, not a place from prose).
 *
 * Field names are those of aihydro-tools 2.5.0 / aihydro-data 0.2.x:
 *   result       `_run_id`, `site_resolution`, `quality`, `upstream`, `product`, `source`, `basin_ref`, `gauge_id`
 *   error        `error: true`, `code`, `message`, `recovery`, `next_tools`, `example_call`, `details.candidates`
 *   tools/list   `description`, `inputSchema`, `annotations`
 * See webview-ui/src/screens/fixtures/aihydro/README.md for where each was recorded.
 *
 * No React and no webview imports (one relative import of a pure name list): importable from the extension host and
 * from tests (ADR-008 b).
 */

import { isFirstPartyServerName } from "./firstPartyServers"

/**
 * The first-party server whose tool calls get science cards. A server-identity switch, never per tool.
 * By name only (see firstPartyServers.ts for what that does and does not establish).
 */
export const isScienceServer = isFirstPartyServerName

/** MCP tool annotations as served by tools/list. Hints, not guarantees. */
export interface ToolAnnotationsInput {
	title?: string
	readOnlyHint?: boolean
	destructiveHint?: boolean
	idempotentHint?: boolean
	openWorldHint?: boolean
}

/** Tool metadata the webview already holds (the server's tools/list entry). */
export interface ToolMetaInput {
	description?: string
	/** JSON Schema, as an object or as the JSON string the proto state carries. */
	inputSchema?: unknown
}

export interface TypedArg {
	name: string
	/** Compact display value. Long strings, arrays and objects are summarised; the raw JSON stays in `rawArgs`. */
	value: string
	/** Schema type, when the input schema names one. */
	type?: string
	/** Units, only from the schema's `x-units` or an explicit "units: ..." in the property description. */
	units?: string
	required: boolean
	/** False when the argument is not in the input schema (or no schema was available). */
	inSchema: boolean
}

export interface DataSource {
	/** `upstream.backend` */
	backend?: string
	/** `product` of the result */
	product?: string
	/** `source` of the result */
	source?: string
	/** `upstream.retrieved_at` */
	retrievedAt?: string
}

export interface PlaceInfo {
	kind: "basin_ref" | "site_resolution" | "gauge_id"
	label: string
	detail?: string
}

export type AreaCheck = "pass" | "fail" | "unavailable"

/** The ADR-003 A2 gauge-resolution record, reduced to what the chip shows. */
export interface SiteResolutionInfo {
	site?: string
	siteName?: string
	method?: string
	/** Signed metres along the river network; only `outlet_snap` reports it. */
	distanceM?: number
	/** `undefined` when the record carries no recognised `area_check`. */
	areaCheck?: AreaCheck
	logAreaRatio?: number
	areaRatio?: number
	maxAbsLogAreaRatio?: number
	warnings: string[]
}

export interface QualityInfo {
	rows?: number
	/** `approval_status` counts exactly as reported, e.g. `{ Approved: 77, Provisional: 43 }`. */
	approvalCounts?: Record<string, number>
	provisional?: { count: number; total: number; first?: string; last?: string }
	/** Reported only when present; zero counts are kept so the card can omit them deliberately. */
	nNegative?: number
	nNullValues?: number
	/** Qualifier tokens outside the documented set, with counts. */
	qualifiersOther?: Record<string, number>
}

export const INFORMATION_CLASSES = ["observed", "modelled", "reanalysis", "derived", "projection"] as const

export interface InformationClassInfo {
	/** The server's own value, unchanged. */
	value: string
	/** False when the value is not one of INFORMATION_CLASSES. */
	recognised: boolean
}

export interface RefusalInfo {
	/** Error code; undefined when the envelope carries none (the arg-repair envelope has none). */
	code?: string
	message?: string
	/** Recovery options as text. Never a button. */
	recovery: string[]
	nextTools: string[]
	/** `example_call` serialised for display. Shown as text; nothing runs it. */
	exampleCall?: string
	/** `details.candidates` entries as text (for example the gauges a name matched). */
	candidates: string[]
}

export type ResultState = "pending" | "ok" | "error" | "unparsed"

export interface ToolCardModel {
	serverName: string
	toolName: string
	purpose?: string
	/** Plain-language reading of the server's annotation hints; undefined when none were served. */
	effectHint?: string
	typedArgs: TypedArg[]
	dataSource?: DataSource
	place?: PlaceInfo
	siteResolution?: SiteResolutionInfo
	runId?: string
	/** `session_id` the result itself carries (top level or `data`); never taken from anywhere else. */
	sessionId?: string
	quality?: QualityInfo
	/** From the explicit `information_class` field only. */
	informationClass?: InformationClassInfo
	refusal?: RefusalInfo
	/** Result images appended by the host (`data:image/...` URLs). */
	images: string[]
	rawArgs: string
	rawResult?: string
	resultState: ResultState
}

// ───────────────────────── helpers ─────────────────────────

type Json = Record<string, unknown>

const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)

/** First sentence of the first paragraph of a tool description. */
export function firstSentence(description: string | undefined): string | undefined {
	const text = str(description)
	if (!text) {
		return undefined
	}
	const paragraph = text
		.trim()
		.split(/\n\s*\n/)[0]
		.replace(/\s+/g, " ")
		.trim()
	const match = /^(.+?[.!?])(?:\s|$)/.exec(paragraph)
	return (match ? match[1] : paragraph) || undefined
}

function parseJsonObject(text: string): Json | undefined {
	try {
		const parsed = JSON.parse(text)
		return isRecord(parsed) ? parsed : undefined
	} catch {
		return undefined
	}
}

function parseSchema(schema: unknown): Json | undefined {
	if (typeof schema === "string") {
		return parseJsonObject(schema)
	}
	return isRecord(schema) ? schema : undefined
}

function schemaType(prop: unknown): string | undefined {
	if (!isRecord(prop)) {
		return undefined
	}
	if (typeof prop.type === "string") {
		return prop.type
	}
	if (Array.isArray(prop.type)) {
		return prop.type.filter((t) => typeof t === "string" && t !== "null").join(" | ") || undefined
	}
	const variants = Array.isArray(prop.anyOf) ? prop.anyOf : Array.isArray(prop.oneOf) ? prop.oneOf : undefined
	if (variants) {
		const names = variants
			.map((v) => (isRecord(v) && typeof v.type === "string" ? v.type : undefined))
			.filter((t): t is string => !!t && t !== "null")
		return names.length ? Array.from(new Set(names)).join(" | ") : undefined
	}
	return undefined
}

function schemaUnits(prop: unknown): string | undefined {
	if (!isRecord(prop)) {
		return undefined
	}
	const explicit = str(prop["x-units"])
	if (explicit) {
		return explicit
	}
	const description = str(prop.description)
	const match = description ? /\bunits?\s*[:=]\s*([^;.)\n]+)/i.exec(description) : null
	return match ? match[1].trim() : undefined
}

const MAX_INLINE = 60

function formatArgValue(value: unknown): string {
	if (value === null) {
		return "null"
	}
	if (typeof value === "string") {
		if (value === "") {
			return '""'
		}
		return value.length > MAX_INLINE ? `${value.slice(0, MAX_INLINE)}… (${value.length} characters)` : value
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value)
	}
	if (Array.isArray(value)) {
		const scalars = value.every((v) => ["string", "number", "boolean"].includes(typeof v))
		const inline = scalars ? JSON.stringify(value) : ""
		return scalars && inline.length <= MAX_INLINE ? inline : `list of ${value.length}`
	}
	if (isRecord(value)) {
		return `object with ${Object.keys(value).length} keys`
	}
	return String(value)
}

function presentArgs(args: Json | undefined, schemaInput: unknown): TypedArg[] {
	const schema = parseSchema(schemaInput)
	const props = schema && isRecord(schema.properties) ? schema.properties : {}
	const required = new Set(Array.isArray(schema?.required) ? (schema.required as unknown[]).map(String) : [])
	return Object.entries(args ?? {}).map(([name, value]) => {
		const prop = props[name]
		return {
			name,
			value: formatArgValue(value),
			type: schemaType(prop),
			units: schemaUnits(prop),
			required: required.has(name),
			inSchema: name in props,
		}
	})
}

/** The host appends tool images to the response text as `\n\n<data URL>`; only that trailing run is taken. */
const IMAGE_TAIL = /((?:\n\ndata:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+)+)$/

function splitImages(text: string): { text: string; images: string[] } {
	const match = IMAGE_TAIL.exec(text)
	if (!match) {
		return { text, images: [] }
	}
	return { text: text.slice(0, match.index), images: match[1].split("\n\n").filter(Boolean) }
}

interface ParsedResult {
	body?: Json
	/** The host prefixes `Error:\n` when the MCP result had isError. */
	isError: boolean
}

function parseResult(text: string): ParsedResult {
	let body = text.trim()
	let isError = false
	if (body.startsWith("Error:")) {
		isError = true
		body = body.slice("Error:".length).trim()
	}
	const whole = parseJsonObject(body)
	if (whole) {
		return { body: whole, isError }
	}
	// Several content items are joined with a blank line; the structured one comes first.
	const first = body.split(/\n\s*\n/)[0]
	return { body: first !== body ? parseJsonObject(first) : undefined, isError }
}

function at(body: Json, ...path: string[]): unknown {
	let cur: unknown = body
	for (const key of path) {
		if (!isRecord(cur)) {
			return undefined
		}
		cur = cur[key]
	}
	return cur
}

function presentDataSource(body: Json): DataSource | undefined {
	const out: DataSource = {
		backend: str(at(body, "upstream", "backend")),
		product: str(body.product),
		source: str(body.source),
		retrievedAt: str(at(body, "upstream", "retrieved_at")),
	}
	return Object.values(out).some((v) => v !== undefined) ? out : undefined
}

function aliasText(alias: unknown): string | undefined {
	if (!isRecord(alias)) {
		return undefined
	}
	const scheme = str(alias.scheme)
	const id = str(alias.id)
	return scheme && id ? `${scheme}:${id}` : undefined
}

function presentPlace(body: Json): PlaceInfo | undefined {
	const basin = isRecord(body.basin_ref)
		? body.basin_ref
		: isRecord(at(body, "data", "basin_ref"))
			? (at(body, "data", "basin_ref") as Json)
			: undefined
	if (basin) {
		const aliases = (Array.isArray(basin.aliases) ? basin.aliases : []).map(aliasText).filter((a): a is string => !!a)
		const label = aliases[0] ?? str(basin.id)
		if (label) {
			const area = num(basin.area_km2)
			const detail = [aliases.slice(label === aliases[0] ? 1 : 0).join(", "), area !== undefined ? `${area} km²` : ""]
				.filter(Boolean)
				.join(" · ")
			return { kind: "basin_ref", label, detail: detail || undefined }
		}
	}
	const site = str(at(body, "site_resolution", "site"))
	if (site) {
		return { kind: "site_resolution", label: site, detail: str(at(body, "site_resolution", "site_name")) }
	}
	const gauge = str(body.gauge_id) ?? str(at(body, "data", "gauge_id")) ?? str(at(body, "meta", "gauge_id"))
	return gauge ? { kind: "gauge_id", label: gauge } : undefined
}

function presentSiteResolution(body: Json): SiteResolutionInfo | undefined {
	const sr = body.site_resolution
	if (!isRecord(sr) || Object.keys(sr).length === 0) {
		return undefined
	}
	const check = str(sr.area_check)
	return {
		site: str(sr.site),
		siteName: str(sr.site_name),
		method: str(sr.method),
		distanceM: num(sr.distance_m),
		areaCheck: check === "pass" || check === "fail" || check === "unavailable" ? check : undefined,
		logAreaRatio: num(sr.log_area_ratio),
		areaRatio: num(sr.area_ratio),
		maxAbsLogAreaRatio: num(at(sr, "thresholds", "max_abs_log_area_ratio")),
		warnings: (Array.isArray(sr.warnings) ? sr.warnings : []).filter((w): w is string => typeof w === "string"),
	}
}

function presentQuality(body: Json): QualityInfo | undefined {
	const q = body.quality
	if (!isRecord(q)) {
		return undefined
	}
	const rows = num(q.n_rows)
	let approvalCounts: Record<string, number> | undefined
	if (isRecord(q.approval_counts)) {
		approvalCounts = {}
		for (const [k, v] of Object.entries(q.approval_counts)) {
			const n = num(v)
			if (n !== undefined) {
				approvalCounts[k] = n
			}
		}
	}
	let provisional: QualityInfo["provisional"]
	if (approvalCounts && rows !== undefined) {
		provisional = {
			count: approvalCounts.Provisional ?? 0,
			total: rows,
			first: str(q.provisional_first),
			last: str(q.provisional_last),
		}
	}
	let qualifiersOther: Record<string, number> | undefined
	if (isRecord(q.qualifiers_other)) {
		qualifiersOther = {}
		for (const [k, v] of Object.entries(q.qualifiers_other)) {
			const n = num(v)
			if (n !== undefined) {
				qualifiersOther[k] = n
			}
		}
	}
	return rows === undefined && !approvalCounts
		? undefined
		: { rows, approvalCounts, provisional, nNegative: num(q.n_negative), nNullValues: num(q.n_null_values), qualifiersOther }
}

function presentInformationClass(body: Json): InformationClassInfo | undefined {
	const value = str(body.information_class)
	return value ? { value, recognised: (INFORMATION_CLASSES as readonly string[]).includes(value) } : undefined
}

const asTextList = (v: unknown): string[] =>
	(Array.isArray(v) ? v : v === undefined || v === null ? [] : [v])
		.map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
		.filter((s) => s.trim() !== "")

function candidateText(c: unknown): string {
	if (typeof c === "string") {
		return c
	}
	return (isRecord(c) && (str(c.site) ?? str(c.id))) || JSON.stringify(c)
}

/** The envelope's error text when `error` is a non-empty string (a first-party tool that returns {"error": "..."}). */
const errorString = (body: Json): string | undefined => str(body.error)

/**
 * A refusal: the U4 envelope (`error: true`), a non-empty string `error`, `ok: false`, `isError: true`, or a
 * host-marked tool error. A refusal without a code reads "code not reported"; it is never shown as a success.
 */
function presentRefusal(body: Json | undefined, isError: boolean, rawText: string): RefusalInfo | undefined {
	const envelope =
		body && (body.error === true || body.isError === true || body.ok === false || errorString(body) !== undefined)
			? body
			: undefined
	if (!envelope && !isError) {
		return undefined
	}
	if (!envelope) {
		return { message: rawText.replace(/^Error:\s*/, "").trim() || undefined, recovery: [], nextTools: [], candidates: [] }
	}
	const example = envelope.example_call
	const candidates = at(envelope, "details", "candidates")
	return {
		code: str(envelope.code),
		message: str(envelope.message) ?? errorString(envelope),
		recovery: asTextList(envelope.recovery),
		nextTools: asTextList(envelope.next_tools),
		exampleCall: example === undefined ? undefined : typeof example === "string" ? example : JSON.stringify(example),
		candidates: Array.isArray(candidates) ? candidates.map(candidateText) : [],
	}
}

function presentEffect(annotations: ToolAnnotationsInput | undefined): string | undefined {
	if (!annotations) {
		return undefined
	}
	if (annotations.readOnlyHint === true) {
		return "Read-only (server hint)"
	}
	if (annotations.readOnlyHint === false) {
		return annotations.destructiveHint === true
			? "May change or delete data (server hint)"
			: "May write session data (server hint)"
	}
	return undefined
}

// ───────────────────────── entry points ─────────────────────────

/**
 * Presents one tool call. `resultText` undefined means the call has not returned yet.
 * Never throws: unparsable input yields a model whose fields are all undefined and whose raw text is kept.
 */
export function presentToolCall(
	serverName: string,
	toolName: string,
	argsJson: string | undefined,
	resultText: string | undefined,
	annotations?: ToolAnnotationsInput,
	tool?: ToolMetaInput,
): ToolCardModel {
	const rawArgs = argsJson ?? ""
	const args = rawArgs.trim() ? parseJsonObject(rawArgs) : {}
	const base: ToolCardModel = {
		serverName,
		toolName,
		purpose: firstSentence(tool?.description),
		effectHint: presentEffect(annotations),
		typedArgs: presentArgs(args, tool?.inputSchema),
		images: [],
		rawArgs,
		rawResult: resultText,
		resultState: "pending",
	}
	if (resultText === undefined) {
		return base
	}
	const { text, images } = splitImages(resultText)
	const { body, isError } = parseResult(text)
	const refusal = presentRefusal(body, isError, text)
	const model: ToolCardModel = { ...base, images, refusal, rawResult: text }
	model.resultState = refusal ? "error" : body ? "ok" : "unparsed"
	if (body) {
		model.dataSource = presentDataSource(body)
		model.place = presentPlace(body)
		model.siteResolution = presentSiteResolution(body)
		model.runId = str(body._run_id)
		model.sessionId = str(body.session_id) ?? str(at(body, "data", "session_id"))
		model.quality = presentQuality(body)
		model.informationClass = presentInformationClass(body)
	}
	return model
}

// ───────────────────────── formatting shared by the card and tests ─────────────────────────

export const NOT_REPORTED_TEXT = "not reported"

function trimTime(iso: string): string {
	return iso.endsWith("T00:00:00") ? iso.slice(0, 10) : iso
}

/** "provisional 43/120 (2026-09-04 to 2026-10-16)". */
export function describeProvisional(p: NonNullable<QualityInfo["provisional"]>): string {
	let dates = ""
	if (p.count > 0) {
		dates = p.first && p.last ? ` (${trimTime(p.first)} to ${trimTime(p.last)})` : " (dates not reported)"
	}
	return `provisional ${p.count}/${p.total}${dates}`
}

/** Extra quality facts, shown only when present and non-zero (the raw row is hidden by default). */
export function describeQualityExtras(q: QualityInfo): string[] {
	const out: string[] = []
	if (q.nNegative) {
		out.push(`${q.nNegative} negative value${q.nNegative === 1 ? "" : "s"} (kept, not converted)`)
	}
	if (q.nNullValues) {
		out.push(`${q.nNullValues} null value${q.nNullValues === 1 ? "" : "s"} dropped`)
	}
	const other = Object.entries(q.qualifiersOther ?? {}).filter(([, n]) => n > 0)
	if (other.length) {
		out.push(`other qualifiers: ${other.map(([k, n]) => `${k} ${n}`).join(", ")}`)
	}
	return out
}

/** One precision per quantity: distance 1 decimal (m), log area ratio and its limit 3 decimals, ratio 3 significant figures. */
const fixed3 = (n: number) => n.toFixed(3)

/** Chip text: "method · distance · area check pass". Missing parts say "not reported". */
export function describeSiteResolution(sr: SiteResolutionInfo): string {
	const distance = sr.distanceM === undefined ? `distance ${NOT_REPORTED_TEXT}` : `${sr.distanceM.toFixed(1)} m`
	const check = sr.areaCheck === undefined ? `area check ${NOT_REPORTED_TEXT}` : `area check ${sr.areaCheck}`
	return [sr.method ?? `method ${NOT_REPORTED_TEXT}`, distance, check].join(" · ")
}

/** Hover text carrying the log-area ratio. */
export function describeAreaRatio(sr: SiteResolutionInfo): string {
	const parts = [
		sr.logAreaRatio === undefined ? `log area ratio ${NOT_REPORTED_TEXT}` : `log area ratio ${fixed3(sr.logAreaRatio)}`,
	]
	if (sr.areaRatio !== undefined) {
		parts.push(`gauge/basin area ratio ${sr.areaRatio.toPrecision(3)}`)
	}
	if (sr.maxAbsLogAreaRatio !== undefined) {
		parts.push(`limit ±${fixed3(sr.maxAbsLogAreaRatio)}`)
	}
	return parts.join("; ")
}

/** Gauge identities the server honoured as asserted (explicit id or BasinRef alias). */
export function assertedGauge(sr: SiteResolutionInfo): boolean {
	return sr.method === "explicit_id" || sr.method === "basin_ref_alias"
}

// ───────────────────────── call / response pairing ─────────────────────────

type PairMessage = { ts: number; ask?: string; say?: string; text?: string }

export type PairStatus =
	| { status: "paired"; resultText: string }
	/** More than one call was outstanding when a response arrived, so it cannot be attributed. Never guessed. */
	| { status: "unpaired" }

export interface Pairing {
	/** Per science tool call `ts`: its response, or unpaired. Calls absent from the map have no response yet. */
	byCallTs: Map<number, PairStatus>
	/** Indexes of `mcp_server_response` messages that a card shows (and the list therefore hides). */
	hiddenResponses: Set<number>
}

const isCall = (m: PairMessage) => m.ask === "use_mcp_server" || m.say === "use_mcp_server"

function callInfo(m: PairMessage): { science: boolean } {
	try {
		const call = JSON.parse(m.text ?? "{}")
		return { science: !!call && call.type === "use_mcp_tool" && isScienceServer(str(call.serverName)) }
	} catch {
		return { science: false }
	}
}

/**
 * The message stream carries no tool-use id, so a response is attributed only when it is unambiguous: exactly
 * one MCP call is outstanding, that call is a first-party tool call, and nothing else intervened. Any other
 * arrangement (two calls outstanding, a response with no call) leaves the response unpaired: the card says so and
 * the response row stays visible. One rule for the card and for the list filter, computed in one pass.
 */
export function pairScienceCalls(messages: ReadonlyArray<PairMessage>): Pairing {
	const byCallTs = new Map<number, PairStatus>()
	const hiddenResponses = new Set<number>()
	let outstanding: Array<{ ts: number; science: boolean }> = []
	messages.forEach((m, index) => {
		if (isCall(m)) {
			outstanding.push({ ts: m.ts, ...callInfo(m) })
		} else if (m.say === "mcp_server_response") {
			if (outstanding.length === 1 && outstanding[0].science) {
				byCallTs.set(outstanding[0].ts, { status: "paired", resultText: m.text ?? "" })
				hiddenResponses.add(index)
			} else {
				for (const call of outstanding) {
					if (call.science) {
						byCallTs.set(call.ts, { status: "unpaired" })
					}
				}
			}
			outstanding = []
		}
	})
	return { byCallTs, hiddenResponses }
}

const pairingCache = new WeakMap<object, Pairing>()

/** `pairScienceCalls`, computed once per message-list identity. */
export function getPairing(messages: ReadonlyArray<PairMessage>): Pairing {
	let cached = pairingCache.get(messages)
	if (!cached) {
		cached = pairScienceCalls(messages)
		pairingCache.set(messages, cached)
	}
	return cached
}
