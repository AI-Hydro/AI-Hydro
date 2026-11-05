import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { REVIEW_VERDICTS, type ReviewVerdict, type SubagentReviewReport } from "@shared/aihydro/subagents"
import { AiHydroDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

/** Caps applied by the host, so a reviewer cannot hand a huge blob to its parent. */
export const REVIEW_LIMITS = {
	summaryChars: 1_500,
	verdicts: 30,
	statementChars: 400,
	evidenceChars: 400,
	questionChars: 300,
	questions: 10,
} as const

function cut(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export type ReviewParse = { ok: true; review: SubagentReviewReport; trimmed: string[] } | { ok: false; error: string }

/**
 * Validate a report_review call. A line is `verdict | statement | evidence`. A verdict word the host does not know is
 * an error the model is told, not a guess: an unknown word is never read as "supported". Every cut is named.
 */
export function parseReview(params: ToolUse["params"]): ReviewParse {
	const summary = (params.summary ?? "").trim()
	if (!summary) {
		return { ok: false, error: "report_review needs a non-empty summary." }
	}
	const rows = (params.verdicts ?? "")
		.split(/\r?\n/)
		.map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
		.filter(Boolean)
	if (rows.length === 0) {
		return {
			ok: false,
			error: "report_review needs verdicts: one line per statement, as 'supported | <statement> | <evidence>'.",
		}
	}
	const verdicts: SubagentReviewReport["verdicts"] = []
	for (const [index, row] of rows.entries()) {
		const parts = row.split("|").map((part) => part.trim())
		const word = parts[0]?.toLowerCase() as ReviewVerdict
		if (parts.length < 2 || !REVIEW_VERDICTS.includes(word) || !parts[1]) {
			return {
				ok: false,
				error: `Verdict line ${index + 1} is not 'supported | <statement> | <evidence>' (the first part must be one of ${REVIEW_VERDICTS.join(", ")}).`,
			}
		}
		const evidence = cut(parts.slice(2).join(" | ").trim(), REVIEW_LIMITS.evidenceChars)
		// "Supported" with no source is a claim of support nobody can check: it is reported as unsupported, and says why.
		const unsourced = word === "supported" && !evidence
		verdicts.push({
			statement: cut(parts[1], REVIEW_LIMITS.statementChars),
			verdict: unsourced ? "unsupported" : word,
			evidence: unsourced ? "no source named" : evidence,
		})
	}
	const trimmed: string[] = []
	const cappedSummary = cut(summary, REVIEW_LIMITS.summaryChars)
	if (cappedSummary !== summary) {
		trimmed.push(`summary cut to ${REVIEW_LIMITS.summaryChars} characters`)
	}
	if (verdicts.length > REVIEW_LIMITS.verdicts) {
		trimmed.push(`${verdicts.length - REVIEW_LIMITS.verdicts} verdicts dropped`)
		verdicts.length = REVIEW_LIMITS.verdicts
	}
	const questionLines = (params.open_questions ?? "")
		.split(/\r?\n/)
		.map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
		.filter(Boolean)
	if (questionLines.length > REVIEW_LIMITS.questions) {
		trimmed.push(`${questionLines.length - REVIEW_LIMITS.questions} open_questions entries dropped`)
	}
	return {
		ok: true,
		review: {
			summary: cappedSummary,
			verdicts,
			openQuestions: questionLines.slice(0, REVIEW_LIMITS.questions).map((q) => cut(q, REVIEW_LIMITS.questionChars)),
		},
		trimmed,
	}
}

/**
 * Registered only on a reviewer's executor. It writes nothing and raises no ask; it validates the review and hands it
 * to the runner's sink. The result is advisory text from a second model run: it grants nothing and touches no claim.
 */
export class ReportReviewHandler implements IFullyManagedTool {
	readonly name = AiHydroDefaultTool.REPORT_REVIEW

	constructor(private readonly sink: (review: SubagentReviewReport) => void) {}

	getDescription(_block: ToolUse): string {
		return `[${this.name}]`
	}

	async handlePartialBlock(_block: ToolUse, _uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		// A child's blocks are only executed when complete, and this tool has no UI.
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const parsed = parseReview(block.params)
		if (!parsed.ok) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(parsed.error)
		}
		this.sink(parsed.review)
		return parsed.trimmed.length
			? `Review recorded (${parsed.trimmed.join("; ")}). You are finished.`
			: "Review recorded. You are finished."
	}
}
