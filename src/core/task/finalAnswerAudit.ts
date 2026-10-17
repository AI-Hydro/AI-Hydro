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
	| { status: "skipped"; reason: "no-ai-hydro-server" | "nothing-to-audit" }
	| { status: "passed"; cited?: number; total?: number }
	| { status: "violations"; violations: AuditViolationView[]; totalViolations: number; cited?: number; total?: number }
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

	let response: McpToolCallResponse
	try {
		const ctx = buildAiHydroCallContext({ prose: answer }, ulid, workspaceRoot, args.modelIdReturned)
		response = await withTimeout(
			hub.callTool(server.name, AUDIT_TOOL_NAME, ctx.args, ulid, ctx.meta),
			args.timeoutMs ?? DEFAULT_AUDIT_TIMEOUT_MS,
		)
	} catch (error) {
		return unavailable(error instanceof Error ? error.message : String(error))
	}

	const text = (response?.content ?? [])
		.map((c: any) => (c?.type === "text" ? c.text : ""))
		.filter(Boolean)
		.join("\n")
	if (response?.isError) {
		return unavailable(text || "the audit tool reported an error")
	}
	let parsed: any
	try {
		parsed = JSON.parse(text)
	} catch {
		return unavailable("the audit tool returned a response that is not JSON")
	}
	if (parsed && typeof parsed.error === "string") {
		// e.g. no research session is bound to this chat, so there is no evidence ledger to check against
		return unavailable(parsed.error)
	}
	if (!parsed || typeof parsed.passed !== "boolean") {
		return unavailable("the audit tool returned an unrecognised response")
	}
	const cited = typeof parsed.cited_numeric_count === "number" ? parsed.cited_numeric_count : undefined
	const total = typeof parsed.total_numeric_count === "number" ? parsed.total_numeric_count : undefined
	if (parsed.passed) {
		return { status: "passed", cited, total }
	}
	const raw: any[] = Array.isArray(parsed.violations) ? parsed.violations : []
	return {
		status: "violations",
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
			return `**Answer audit passed**${
				outcome.total !== undefined && outcome.cited !== undefined
					? `: ${outcome.cited}/${outcome.total} numbers cited`
					: ""
			}. ${note}`
		case "violations": {
			const header = `**Answer audit found ${outcome.totalViolations} issue${outcome.totalViolations === 1 ? "" : "s"}**${
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
					parts.push(`Fix: ${v.fixHint}`)
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
