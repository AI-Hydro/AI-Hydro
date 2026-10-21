import { createHash } from "node:crypto"
import { isServerTrusted } from "@shared/aihydro/firstPartyServers"
import {
	ANSWER_AUDIT_PAYLOAD_VERSION,
	type AnswerAuditPayload,
	type AnswerAuditSchema,
	type AnswerAuditSeverity,
	type AnswerAuditStage,
	type AnswerAuditViolation,
	countFindings,
} from "@shared/aihydro/transcriptContracts"
import type { McpServer, McpToolCallResponse } from "@shared/mcp"
import { buildAiHydroCallContext } from "@/core/mcp/aihydroContext"
import { isAiHydroServerName } from "./tools/handlers/aiHydroServer"

/**
 * Final-answer audit (mechanism, not prompt).
 *
 * When the agent completes, the final answer text is sent to the AI-Hydro MCP server's
 * `audit_interpretation` tool and the outcome is shown to the user. This closes the gap where the
 * `[run:...#path]` evidence grammar only constrained `write_research_interpretation`, never what the
 * researcher actually reads.
 *
 * Contract:
 *  - DISPLAY ONLY unless the pre-completion gate is on (`finalAnswerAuditGate`, default off; see answerAuditGate.ts).
 *    Without it the audit never blocks completion and never alters the answer.
 *  - Failures are reported as "audit unavailable", never swallowed and never treated as a pass.
 *  - Silent only when there is nothing to audit (no AI-Hydro server connected, or no numbers/markers).
 */

export const AUDIT_TOOL_NAME = "audit_interpretation"
export const CHAT_STATUS_TOOL_NAME = "aihydro_chat_status"
export const DEFAULT_AUDIT_TIMEOUT_MS = 15_000
/** Display cap for the plain-text fallback only. The data (outcome and payload) is never truncated. */
const MAX_VIOLATIONS_IN_TEXT = 10

export interface AuditHub {
	getServers(): McpServer[]
	callTool(
		serverName: string,
		toolName: string,
		toolArguments: Record<string, unknown> | undefined,
		ulid: string,
		meta?: Record<string, unknown>,
	): Promise<McpToolCallResponse>
}

export interface AuditViolationView {
	kind: string
	/** `unknown` for responses from tools older than the graded schema: never inferred as hard. */
	severity: AnswerAuditSeverity
	excerpt?: string
	message?: string
	fixHint?: string
	/** Graded schema (aihydro-tools >= 2.6.0) extras. */
	category?: string
	suggestedMarker?: string
	resolvedPath?: string
}

export type FinalAnswerAuditOutcome =
	| { status: "skipped"; reason: "no-ai-hydro-server" | "nothing-to-audit" | "no-research-session" }
	| { status: "passed"; sessionId?: string; cited?: number; total?: number; schema: AnswerAuditSchema }
	| {
			// Any finding, hard or advisory. A graded response with only advisories has `hardCount === 0`
			// (the tools' `passed`), but it is still reported as "violations": "passed" means nothing was found.
			status: "violations"
			sessionId?: string
			/** The complete list; display caps are the renderer's job. */
			violations: AuditViolationView[]
			totalViolations: number
			hardCount: number
			advisoryCount: number
			exemptByReason?: Record<string, number>
			schema: AnswerAuditSchema
			cited?: number
			total?: number
	  }
	| { status: "unavailable"; reason: string }

/** Numeric literals or evidence markers: the things the auditor can say anything about. */
export function hasAuditableContent(answer: string): boolean {
	return /\d/.test(answer) || /\[(?:run|claim|lit):/i.test(answer)
}

/**
 * The server that audits. Alias-named servers are candidates; a trusted one (isServerTrusted) is preferred over an
 * untrusted one even when listed later. The W2-C gate passes the exact server it judged eligible and requires trust,
 * because its fix hints reach the model as revision instructions.
 */
function findAuditServer(hub: AuditHub, opts: { serverName?: string; requireTrusted?: boolean } = {}): McpServer | undefined {
	const candidates = hub
		.getServers()
		.filter(
			(s) =>
				isAiHydroServerName(s.name) &&
				s.status === "connected" &&
				!s.disabled &&
				(!opts.serverName || s.name === opts.serverName),
		)
	const trusted = candidates.find((s) => isServerTrusted(s as any))
	return trusted ?? (opts.requireTrusted ? undefined : candidates[0])
}

function unavailable(reason: string): FinalAnswerAuditOutcome {
	return { status: "unavailable", reason: reason.replace(/\s+/g, " ").trim().slice(0, 300) || "unknown error" }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	let timer: NodeJS.Timeout
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`timed out after ${Math.round(ms / 1000)}s`)), ms)
	})
	return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

function responseJson(response: McpToolCallResponse): { json?: any; text: string; isError: boolean } {
	const text = (response?.content ?? [])
		.map((c: any) => (c?.type === "text" ? c.text : ""))
		.filter(Boolean)
		.join("\n")
	try {
		return { json: JSON.parse(text), text, isError: !!response?.isError }
	} catch {
		return { text, isError: !!response?.isError }
	}
}

export async function runFinalAnswerAudit(args: {
	hub: AuditHub
	ulid: string
	workspaceRoot: string | undefined
	answer: string
	modelIdReturned?: string
	timeoutMs?: number
	/**
	 * Study already verified as bound to this chat by an earlier status call in this task (the W2-C gate's cache, so
	 * revision rounds do not repeat the status round trip). The audited session must still equal it.
	 */
	boundStudy?: string
	/** The exact server to audit on (the gate's eligible server) and whether it must be trusted. */
	serverName?: string
	requireTrusted?: boolean
}): Promise<FinalAnswerAuditOutcome> {
	const { hub, ulid, workspaceRoot, answer } = args
	const server = findAuditServer(hub, { serverName: args.serverName, requireTrusted: args.requireTrusted })
	if (!server) {
		return { status: "skipped", reason: "no-ai-hydro-server" }
	}
	if (!hasAuditableContent(answer)) {
		return { status: "skipped", reason: "nothing-to-audit" }
	}
	if (server.tools && server.tools.length > 0 && !server.tools.some((t) => t.name === AUDIT_TOOL_NAME)) {
		return unavailable(`server '${server.name}' does not expose ${AUDIT_TOOL_NAME}`)
	}

	// The server resolves "which study?" with a fallback to the most recently modified study on disk.
	// That must never decide which evidence ledger audits this answer, so first confirm a study is
	// actually bound to THIS chat, and later require the audited session to be that study.
	let boundStudy: string
	if (args.boundStudy) {
		boundStudy = args.boundStudy
	} else {
		try {
			if (server.tools && server.tools.length > 0 && !server.tools.some((t) => t.name === CHAT_STATUS_TOOL_NAME)) {
				return unavailable(
					`cannot confirm a research session is bound to this chat (${CHAT_STATUS_TOOL_NAME} not exposed)`,
				)
			}
			const statusCtx = buildAiHydroCallContext({ chat_id: ulid }, ulid, workspaceRoot, args.modelIdReturned)
			const status = responseJson(
				await withTimeout(
					hub.callTool(server.name, CHAT_STATUS_TOOL_NAME, statusCtx.args, ulid, statusCtx.meta),
					args.timeoutMs ?? DEFAULT_AUDIT_TIMEOUT_MS,
				),
			)
			if (status.isError || !status.json || typeof status.json.bound !== "boolean") {
				return unavailable("could not determine whether a research session is bound to this chat")
			}
			if (!status.json.bound || typeof status.json.study_id !== "string") {
				return { status: "skipped", reason: "no-research-session" }
			}
			boundStudy = status.json.study_id
		} catch (error) {
			return unavailable(error instanceof Error ? error.message : String(error))
		}
	}

	let response: McpToolCallResponse
	try {
		const ctx = buildAiHydroCallContext({ prose: answer, session_id: boundStudy }, ulid, workspaceRoot, args.modelIdReturned)
		response = await withTimeout(
			hub.callTool(server.name, AUDIT_TOOL_NAME, ctx.args, ulid, ctx.meta),
			args.timeoutMs ?? DEFAULT_AUDIT_TIMEOUT_MS,
		)
	} catch (error) {
		return unavailable(error instanceof Error ? error.message : String(error))
	}

	const { json: parsed, text, isError } = responseJson(response)
	if (isError) {
		return unavailable(text || "the audit tool reported an error")
	}
	if (!parsed) {
		return unavailable("the audit tool returned a response that is not JSON")
	}
	if (typeof parsed.error === "string") {
		return unavailable(parsed.error)
	}
	if (typeof parsed.passed !== "boolean") {
		return unavailable("the audit tool returned an unrecognised response")
	}
	const sessionId = typeof parsed.session_id === "string" ? parsed.session_id : undefined
	if (sessionId !== boundStudy) {
		return unavailable(`audited session '${sessionId ?? "unknown"}' is not the study bound to this chat ('${boundStudy}')`)
	}
	const cited = typeof parsed.cited_numeric_count === "number" ? parsed.cited_numeric_count : undefined
	const total = typeof parsed.total_numeric_count === "number" ? parsed.total_numeric_count : undefined
	// Graded schema (aihydro-tools >= 2.6.0) is detected by the top-level counts; anything else is legacy and its
	// violations carry no severity (never inferred as hard).
	const schema: AnswerAuditSchema = typeof parsed.hard_count === "number" ? "graded" : "legacy"
	const raw: any[] = Array.isArray(parsed.violations) ? parsed.violations : []
	const violations: AuditViolationView[] = raw.map((v) => parseViolationView(v, schema))
	if (violations.length === 0) {
		// "Not passed" with nothing to show is a contradiction: never a pass, never "violations" with 0 findings.
		return parsed.passed ? { status: "passed", sessionId, cited, total, schema } : unavailable("inconsistent audit response")
	}
	const counts = countFindings(violations)
	return {
		status: "violations",
		sessionId,
		totalViolations: violations.length,
		hardCount: counts.hardCount,
		advisoryCount: counts.advisoryCount,
		...(parsed.exempt_by_reason && typeof parsed.exempt_by_reason === "object" && !Array.isArray(parsed.exempt_by_reason)
			? { exemptByReason: parsed.exempt_by_reason as Record<string, number> }
			: {}),
		schema,
		cited,
		total,
		violations,
	}
}

function parseViolationView(v: any, schema: AnswerAuditSchema): AuditViolationView {
	const severity: AnswerAuditSeverity =
		schema === "graded" && (v?.severity === "hard" || v?.severity === "advisory") ? v.severity : "unknown"
	return {
		kind: String(v?.kind ?? "violation"),
		severity,
		excerpt: typeof v?.text_excerpt === "string" ? v.text_excerpt : undefined,
		message: typeof v?.message === "string" ? v.message : undefined,
		fixHint: typeof v?.fix_hint === "string" ? v.fix_hint : undefined,
		...(typeof v?.category === "string" ? { category: v.category } : {}),
		...(typeof v?.suggested_marker === "string" ? { suggestedMarker: v.suggested_marker } : {}),
		...(typeof v?.resolved_path === "string" ? { resolvedPath: v.resolved_path } : {}),
	}
}

/**
 * Build the frozen `answer_audit` v1 payload (JSON-stringified into the say's `text`). `answer` is the text the audit
 * describes; only its sha-256 is stored for a final-stage payload (the answer is already a transcript row).
 */
export function toAnswerAuditPayload(
	outcome: FinalAnswerAuditOutcome,
	opts: { stage: AnswerAuditStage; attempt: number; answerTs: number; answer: string },
): AnswerAuditPayload {
	const draftHash = createHash("sha256").update(opts.answer).digest("hex")
	const base = { v: ANSWER_AUDIT_PAYLOAD_VERSION, stage: opts.stage, attempt: opts.attempt, answerTs: opts.answerTs, draftHash }
	switch (outcome.status) {
		case "skipped":
		case "unavailable":
			return {
				...base,
				status: outcome.status,
				hardCount: 0,
				advisoryCount: 0,
				violations: [],
				schema: "legacy",
				disclosure: {
					kind: outcome.status === "skipped" ? "audit_skipped" : "audit_unavailable",
					reason: outcome.reason,
				},
			}
		case "passed":
			return {
				...base,
				status: "passed",
				...(outcome.sessionId ? { sessionId: outcome.sessionId } : {}),
				...(outcome.cited !== undefined ? { cited: outcome.cited } : {}),
				...(outcome.total !== undefined ? { total: outcome.total } : {}),
				hardCount: 0,
				advisoryCount: 0,
				violations: [],
				schema: outcome.schema,
			}
		case "violations": {
			const violations: AnswerAuditViolation[] = outcome.violations.map((v) => ({
				kind: v.kind,
				severity: v.severity,
				...(v.excerpt ? { excerpt: v.excerpt } : {}),
				...(v.message ? { message: v.message } : {}),
				...(v.fixHint ? { fixHint: v.fixHint } : {}),
				...(v.category ? { category: v.category } : {}),
				...(v.suggestedMarker ? { suggestedMarker: v.suggestedMarker } : {}),
				...(v.resolvedPath ? { resolvedPath: v.resolvedPath } : {}),
			}))
			return {
				...base,
				status: "violations",
				...(outcome.sessionId ? { sessionId: outcome.sessionId } : {}),
				...(outcome.cited !== undefined ? { cited: outcome.cited } : {}),
				...(outcome.total !== undefined ? { total: outcome.total } : {}),
				hardCount: outcome.hardCount,
				advisoryCount: outcome.advisoryCount,
				violations,
				schema: outcome.schema,
				...(outcome.exemptByReason ? { exemptByReason: outcome.exemptByReason } : {}),
			}
		}
	}
}

/** User-facing text for an outcome, or undefined when nothing should be shown. */
export function formatFinalAnswerAudit(outcome: FinalAnswerAuditOutcome): string | undefined {
	const note = "Display only: the answer above is unchanged."
	switch (outcome.status) {
		case "skipped":
			return undefined
		case "unavailable":
			return `**Answer audit unavailable** (${outcome.reason}). The final answer above was NOT checked against the evidence ledger. ${note}`
		case "passed":
			return `**Answer audit: no findings** (study \`${outcome.sessionId}\`)${
				outcome.total !== undefined && outcome.cited !== undefined
					? `: ${outcome.cited}/${outcome.total} numbers cited`
					: ""
			}. ${note}`
		case "violations": {
			const grading =
				outcome.schema === "graded"
					? ` (${outcome.hardCount} hard, ${outcome.advisoryCount} advisory)`
					: " (ungraded: older tools server)"
			const header = `**Answer audit (study \`${outcome.sessionId}\`) found ${outcome.totalViolations} issue${outcome.totalViolations === 1 ? "" : "s"}${grading}**${
				outcome.total !== undefined && outcome.cited !== undefined
					? ` (${outcome.cited}/${outcome.total} numbers cited)`
					: ""
			}. ${note}`
			const shown = outcome.violations.slice(0, MAX_VIOLATIONS_IN_TEXT)
			const lines = shown.map((v, i) => {
				const parts = [`${i + 1}. \`${v.kind}\`${v.severity === "unknown" ? "" : ` [${v.severity}]`}`]
				if (v.excerpt) {
					parts.push(`"${v.excerpt.replace(/\s+/g, " ").slice(0, 120)}"`)
				}
				if (v.message) {
					parts.push(v.message)
				}
				if (v.fixHint) {
					// Code span: grammar examples in the hint ([run:...], [lit:...]) must read as text to copy, never render as chips.
					parts.push(`\`Fix: ${v.fixHint.replace(/`/g, "'").replace(/\s+/g, " ")}\``)
				}
				return parts.join(" - ")
			})
			const more = outcome.totalViolations > shown.length ? [`...and ${outcome.totalViolations - shown.length} more.`] : []
			return [header, ...lines, ...more].join("\n")
		}
	}
}
