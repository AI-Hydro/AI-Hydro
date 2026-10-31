import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import type { SubagentReport } from "@shared/aihydro/subagents"
import { AiHydroDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

/** Caps applied by the host, so a child cannot hand a huge blob to its parent. */
export const REPORT_LIMITS = {
	summaryChars: 1_500,
	findingChars: 400,
	findings: 20,
	pathChars: 300,
	paths: 40,
	questionChars: 300,
	questions: 10,
} as const

function lines(raw: string | undefined): string[] {
	return (raw ?? "")
		.split(/\r?\n/)
		.map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
		.filter(Boolean)
}

function capList(items: string[], count: number, chars: number): { kept: string[]; dropped: number } {
	const kept = items.slice(0, count).map((item) => (item.length > chars ? `${item.slice(0, chars - 1)}…` : item))
	return { kept, dropped: Math.max(0, items.length - count) }
}

export type ReportParse = { ok: true; report: SubagentReport; trimmed: string[] } | { ok: false; error: string }

/** Validate a report_findings call. Every cut is named in `trimmed`, never silent. */
export function parseReport(params: ToolUse["params"]): ReportParse {
	const summary = (params.summary ?? "").trim()
	if (!summary) {
		return { ok: false, error: "report_findings needs a non-empty summary." }
	}
	const trimmed: string[] = []
	const cappedSummary =
		summary.length > REPORT_LIMITS.summaryChars ? `${summary.slice(0, REPORT_LIMITS.summaryChars - 1)}…` : summary
	if (cappedSummary !== summary) {
		trimmed.push(`summary cut to ${REPORT_LIMITS.summaryChars} characters`)
	}
	const findings = capList(lines(params.key_findings), REPORT_LIMITS.findings, REPORT_LIMITS.findingChars)
	const files = capList(lines(params.files_read), REPORT_LIMITS.paths, REPORT_LIMITS.pathChars)
	const questions = capList(lines(params.open_questions), REPORT_LIMITS.questions, REPORT_LIMITS.questionChars)
	for (const [name, list] of [
		["key_findings", findings],
		["files_read", files],
		["open_questions", questions],
	] as const) {
		if (list.dropped) {
			trimmed.push(`${list.dropped} ${name} entries dropped`)
		}
	}
	return {
		ok: true,
		report: { summary: cappedSummary, keyFindings: findings.kept, filesRead: files.kept, openQuestions: questions.kept },
		trimmed,
	}
}

/**
 * Registered only on a subagent's executor. It writes nothing and raises no ask; it validates the report and hands it
 * to the runner's sink. attempt_completion is unavailable to a child because it would raise a `completion_result` ask
 * and run the answer-audit gate on the parent.
 */
export class ReportFindingsHandler implements IFullyManagedTool {
	readonly name = AiHydroDefaultTool.REPORT_FINDINGS

	constructor(private readonly sink: (report: SubagentReport) => void) {}

	getDescription(_block: ToolUse): string {
		return `[${this.name}]`
	}

	async handlePartialBlock(_block: ToolUse, _uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		// A child's blocks are only executed when complete, and this tool has no UI.
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const parsed = parseReport(block.params)
		if (!parsed.ok) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(parsed.error)
		}
		this.sink(parsed.report)
		return parsed.trimmed.length
			? `Findings recorded (${parsed.trimmed.join("; ")}). You are finished.`
			: "Findings recorded. You are finished."
	}
}
