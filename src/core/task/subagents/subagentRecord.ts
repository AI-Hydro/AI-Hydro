import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import type {
	SubagentBudgetStop,
	SubagentProfileId,
	SubagentReport,
	SubagentStatus,
	SubagentToolCallRecord,
	SubagentUsage,
} from "@shared/aihydro/subagents"

/**
 * The extension-side record of one child (plan section 7): `<taskDir>/subagents/<childId>.json`. Server RunRecords do
 * not carry agent identity until the server seals it (audit WP-H8), so this file is the only place that says which
 * agent made a call. Do not describe child calls as agent-attributed RunRecords before that lands.
 *
 * Arguments are hashed, not stored: a child's arguments can hold file contents, and the record is exported.
 */
export interface SubagentRecord {
	schema: "aihydro.subagent-record/1"
	childId: string
	label: string
	parentTaskId: string
	parentUlid: string
	profile: SubagentProfileId
	/**
	 * What this child's MCP calls carried in `_meta["aihydro/context"].agent`. The server does not read it yet, so it is
	 * not in server RunRecords; this file is where it can be checked.
	 */
	agent: { agent_id: string; parent_agent_id: string; role: string }
	/** sha256 of the resolved allowlist (built-ins plus exit tool, sorted), so a record shows what the child could call. */
	allowlistSha256: string
	prompt: string
	promptSha256: string
	modelIdRequested: string
	/** The model id the provider reported serving; absent when it reports none. */
	modelIdReturned?: string
	startedAt: string
	endedAt?: string
	status: SubagentStatus
	budgetStop?: SubagentBudgetStop
	usage: SubagentUsage
	toolCalls: SubagentToolCallRecord[]
	report?: SubagentReport
	/** The child's last assistant text, kept when a budget or an error ended it without a report. */
	lastAssistantText?: string
	error?: string
}

export function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex")
}

export function allowlistSha256(allowlist: readonly string[]): string {
	return sha256([...allowlist].sort().join("\n"))
}

/** Where a record is written, relative to the task directory. */
export function recordRelativePath(childId: string): string {
	return path.posix.join("subagents", `${childId}.json`)
}

/** Writes a record and returns its path relative to the task directory. Injected so tests need no disk. */
export type SubagentRecordWriter = (record: SubagentRecord) => Promise<string>

/** The default writer: atomic (temp file then rename) under the parent task's directory. */
export function diskRecordWriter(taskDir: () => Promise<string>): SubagentRecordWriter {
	return async (record) => {
		const dir = path.join(await taskDir(), "subagents")
		await fs.mkdir(dir, { recursive: true })
		const target = path.join(dir, `${record.childId}.json`)
		const temp = `${target}.${process.pid}.tmp`
		await fs.writeFile(temp, JSON.stringify(record, null, 2), "utf8")
		await fs.rename(temp, target)
		return recordRelativePath(record.childId)
	}
}
