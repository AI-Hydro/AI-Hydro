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
 *  - DISPLAY ONLY. The audit never blocks completion and never alters the answer.
 *  - Failures are reported as "audit unavailable", never swallowed and never treated as a pass.
 *  - Silent only when there is nothing to audit (no AI-Hydro server connected, or no numbers/markers).
 */

export const AUDIT_TOOL_NAME = "audit_interpretation"
export const CHAT_STATUS_TOOL_NAME = "aihydro_chat_status"
export const DEFAULT_AUDIT_TIMEOUT_MS = 15_000
const MAX_VIOLATIONS_SHOWN = 10

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
	excerpt?: string
	message?: string
	fixHint?: string
}

export type FinalAnswerAuditOutcome =
	| { status: "skipped"; reason: "no-ai-hydro-server" | "nothing-to-audit" | "no-research-session" }
	| { status: "passed"; sessionId?: string; cited?: number; total?: number }
	| {
			status: "violations"
			sessionId?: string
			violations: AuditViolationView[]
			totalViolations: number
			cited?: number
			total?: number
	  }
	| { status: "unavailable"; reason: string }

/** Numeric literals or evidence markers: the things the auditor can say anything about. */
export function hasAuditableContent(answer: string): boolean {
	return /\d/.test(answer) || /\[(?:run|claim|lit):/i.test(answer)
}

function findAuditServer(hub: AuditHub): McpServer | undefined {
	return hub.getServers().find((s) => isAiHydroServerName(s.name) && s.status === "connected" && !s.disabled)
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
}): Promise<FinalAnswerAuditOutcome> {
	const { hub, ulid, workspaceRoot, answer } = args
	const server = findAuditServer(hub)
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
	try {
		if (server.tools && server.tools.length > 0 && !server.tools.some((t) => t.name === CHAT_STATUS_TOOL_NAME)) {
			return unavailable(`cannot confirm a research session is bound to this chat (${CHAT_STATUS_TOOL_NAME} not exposed)`)
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
	if (parsed.passed) {
		return { status: "passed", sessionId, cited, total }
	}
	const raw: any[] = Array.isArray(parsed.violations) ? parsed.violations : []
	return {
		status: "violations",
		sessionId,
		totalViolations: raw.length,
		cited,
		total,
		violations: raw.slice(0, MAX_VIOLATIONS_SHOWN).map((v) => ({
			kind: String(v?.kind ?? "violation"),
			excerpt: typeof v?.text_excerpt === "string" ? v.text_excerpt : undefined,
			message: typeof v?.message === "string" ? v.message : undefined,
			fixHint: typeof v?.fix_hint === "string" ? v.fix_hint : undefined,
		})),
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
			return `**Answer audit passed** (study \`${outcome.sessionId}\`)${
				outcome.total !== undefined && outcome.cited !== undefined
					? `: ${outcome.cited}/${outcome.total} numbers cited`
					: ""
			}. ${note}`
		case "violations": {
			const header = `**Answer audit (study \`${outcome.sessionId}\`) found ${outcome.totalViolations} issue${outcome.totalViolations === 1 ? "" : "s"}**${
				outcome.total !== undefined && outcome.cited !== undefined
					? ` (${outcome.cited}/${outcome.total} numbers cited)`
					: ""
			}. ${note}`
			const lines = outcome.violations.map((v, i) => {
				const parts = [`${i + 1}. \`${v.kind}\``]
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
			const more =
				outcome.totalViolations > outcome.violations.length
					? [`...and ${outcome.totalViolations - outcome.violations.length} more.`]
					: []
			return [header, ...lines, ...more].join("\n")
		}
	}
}
