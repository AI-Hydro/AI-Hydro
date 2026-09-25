import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import type { ResearchSnapshot, SnapshotReader } from "./researchSnapshot"

export interface EvidenceSpanSurface {
	sourceType: string
	sourceId: string
	metricRef: string
	description: string
}

export interface ClaimSurfaceRecord {
	claimId: string
	sessionId: string
	statement: string
	status: string
	claimType: string
	confidence: string
	createdAt: string
	updatedAt: string
	evidenceSpans: EvidenceSpanSurface[]
	limitations: string[]
}

export interface ClaimSurface {
	session_id: string
	claims: ClaimSurfaceRecord[]
	sessionPath: string
}

export interface MetricCell {
	value: number | null
	ci_low?: number | null
	ci_high?: number | null
	run_id?: string | null
}

export interface ExperimentDefn {
	experiment_id: string
	name: string
	tool: string
	features: string[]
	params: Record<string, unknown>
	metrics: string[]
	params_hash: string
	created_at: string
}

export interface ExperimentResults {
	status: "pending" | "running" | "complete" | "partial" | "error"
	run_ids: Record<string, string>
	cells: Record<string, Record<string, MetricCell>>
	errors: Record<string, string>
	n_success: number
	n_error: number
	completed_at: string | null
}

export interface ExperimentSurface {
	session_id: string
	experiment_id: string
	defn: ExperimentDefn
	results: ExperimentResults | null
	availableExperimentIds: string[]
	sessionPath: string
}

export interface RunEntry {
	run_id: string
	tool_name: string
	session_id: string
	timestamp: string
	key_outputs: Record<string, unknown>
	inputs?: Record<string, unknown>
	evidence?: Record<string, unknown>
	diff_status?: "match" | "mismatch" | "missing"
	diff_notes?: string[]
}

export interface ReplaySurface {
	session_id: string
	source: "session" | "capsule"
	entries: RunEntry[]
	sessionPath: string
	capsule_path?: string
	warnings: string[]
	run_log_source: ResearchSnapshot["run_log_source"]
}

export function defaultAiHydroHome(): string {
	return path.join(os.homedir(), ".aihydro")
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value)
}

export function resolveSessionJsonPath(sessionIdOrPath: string, home = defaultAiHydroHome()): string | undefined {
	const value = sessionIdOrPath.trim()
	if (!value) {
		return undefined
	}

	const candidates: string[] = []
	if (path.isAbsolute(value) || value.includes(path.sep)) {
		candidates.push(value)
		candidates.push(path.join(value, "session.json"))
	}
	candidates.push(path.join(home, "sessions", `${value}.json`))
	candidates.push(path.join(home, "exports", `capsule_${value}`, "session.json"))
	candidates.push(path.join(home, "capsules", value, "session.json"))

	return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
}

export function listSessionIds(home = defaultAiHydroHome(), limit = 20): string[] {
	const dir = path.join(home, "sessions")
	if (!fs.existsSync(dir)) {
		return []
	}
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
		.map((entry) => {
			const filePath = path.join(dir, entry.name)
			return { id: entry.name.replace(/\.json$/, ""), mtimeMs: fs.statSync(filePath).mtimeMs }
		})
		.sort((a, b) => b.mtimeMs - a.mtimeMs)
		.slice(0, limit)
		.map((entry) => entry.id)
}

function normalizeExperimentDefn(defn: unknown, fallbackId: string): ExperimentDefn {
	const d = isRecord(defn) ? defn : {}
	return {
		experiment_id: String(d.experiment_id ?? fallbackId),
		name: String(d.name ?? fallbackId),
		tool: String(d.tool ?? "unknown"),
		features: Array.isArray(d.features) ? d.features.map(String) : [],
		params: isRecord(d.params) ? d.params : {},
		metrics: Array.isArray(d.metrics) ? d.metrics.map(String) : [],
		params_hash: String(d.params_hash ?? ""),
		created_at: String(d.created_at ?? ""),
	}
}

function normalizeExperimentResults(results: unknown): ExperimentResults | null {
	if (!isRecord(results)) {
		return null
	}
	return {
		status: ["pending", "running", "complete", "partial", "error"].includes(String(results.status))
			? (String(results.status) as ExperimentResults["status"])
			: "pending",
		run_ids: isRecord(results.run_ids)
			? Object.fromEntries(Object.entries(results.run_ids).map(([k, v]) => [k, String(v)]))
			: {},
		cells: isRecord(results.cells) ? (results.cells as ExperimentResults["cells"]) : {},
		errors: isRecord(results.errors)
			? Object.fromEntries(Object.entries(results.errors).map(([k, v]) => [k, String(v)]))
			: {},
		n_success: Number(results.n_success ?? 0),
		n_error: Number(results.n_error ?? 0),
		completed_at: results.completed_at == null ? null : String(results.completed_at),
	}
}

export async function loadExperimentSurface(
	sessionIdOrPath: string,
	experimentId: string,
	readSnapshot: SnapshotReader,
): Promise<ExperimentSurface> {
	const snapshot = await readSnapshot(sessionIdOrPath)
	const sessionPath = snapshot.session_path
	const sessionId = snapshot.session_id
	const experiments = snapshot.experiments
	if (Object.keys(experiments).length === 0) {
		throw new Error(`No experiments found in session '${sessionIdOrPath}'.`)
	}
	const availableExperimentIds = Object.keys(experiments).sort()
	const selectedExperimentId = experimentId.trim() || availableExperimentIds[0] || ""
	const experiment = experiments[selectedExperimentId]
	if (!isRecord(experiment)) {
		throw new Error(
			`Experiment '${selectedExperimentId || experimentId}' not found in session '${sessionIdOrPath}'. Available: ${availableExperimentIds.join(", ") || "(none)"}`,
		)
	}
	return {
		session_id: sessionId,
		experiment_id: selectedExperimentId,
		defn: normalizeExperimentDefn(experiment.defn, selectedExperimentId),
		results: normalizeExperimentResults(experiment.results),
		availableExperimentIds,
		sessionPath,
	}
}

function normalizeRunEntry(value: unknown, fallbackRunId: string, fallbackSessionId: string): RunEntry | undefined {
	if (!isRecord(value)) {
		return undefined
	}
	const keyOutputs = isRecord(value.key_outputs) ? value.key_outputs : isRecord(value.data) ? value.data : {}
	const runId = String(value.run_id ?? fallbackRunId)
	const toolName = String(value.tool_name ?? value.tool ?? (isRecord(value.meta) ? value.meta.tool : "") ?? "unknown")
	return {
		run_id: runId,
		tool_name: toolName || "unknown",
		session_id: String(value.session_id ?? fallbackSessionId),
		timestamp: String(value.timestamp ?? value.created_at ?? (isRecord(value.meta) ? value.meta.computed_at : "") ?? ""),
		key_outputs: keyOutputs,
		inputs: isRecord(value.inputs) ? value.inputs : undefined,
		evidence: isRecord(value.evidence) ? value.evidence : undefined,
		diff_status: ["match", "mismatch", "missing"].includes(String(value.diff_status))
			? (String(value.diff_status) as RunEntry["diff_status"])
			: undefined,
		diff_notes: Array.isArray(value.diff_notes) ? value.diff_notes.map(String) : undefined,
	}
}

export async function loadClaimSurface(sessionIdOrPath: string, readSnapshot: SnapshotReader): Promise<ClaimSurface> {
	const snapshot = await readSnapshot(sessionIdOrPath)
	const sessionPath = snapshot.session_path
	const sessionId = snapshot.session_id
	const mergedClaims = snapshot.claims
	const claims = Object.entries(mergedClaims)
		.map(([claimId, claim]) => normalizeClaimRecord(claimId, claim, sessionId))
		.filter((claim): claim is ClaimSurfaceRecord => !!claim)
		.sort((a, b) => a.claimId.localeCompare(b.claimId))
	const runEntries = snapshot.runs.map((run) => normalizeRunEntry(run, String(run.run_id), sessionId)!)
	const linkedRunIds = new Set(
		claims.flatMap((claim) => claim.evidenceSpans.filter((span) => span.sourceType === "run").map((span) => span.sourceId)),
	)
	const unlinkedRuns = runEntries.filter((entry) => !linkedRunIds.has(entry.run_id))
	if (claims.length === 0) {
		claims.push(...synthesizeEvidenceCandidates(runEntries, sessionId))
	} else if (unlinkedRuns.length > 0) {
		claims.push(...synthesizeEvidenceCandidates(unlinkedRuns, sessionId))
	}
	return { session_id: sessionId, claims, sessionPath }
}

function normalizeEvidenceSpan(value: unknown): EvidenceSpanSurface {
	const span = isRecord(value) ? value : {}
	return {
		sourceType: String(span.source_type ?? span.sourceType ?? ""),
		sourceId: String(span.source_id ?? span.sourceId ?? ""),
		metricRef: String(span.metric_ref ?? span.metricRef ?? ""),
		description: String(span.description ?? ""),
	}
}

function normalizeClaimRecord(claimId: string, value: unknown, fallbackSessionId: string): ClaimSurfaceRecord | undefined {
	if (!isRecord(value)) {
		return undefined
	}
	const sessionId = String(value.session_id ?? value.sessionId ?? fallbackSessionId)
	const spans = Array.isArray(value.evidence_spans)
		? value.evidence_spans
		: Array.isArray(value.evidenceSpans)
			? value.evidenceSpans
			: []
	const normalizedSpans = spans.map(normalizeEvidenceSpan).filter((span) => span.sourceId)
	const rawStatus = String(value.status ?? "proposed")
	const hasEvidence = normalizedSpans.length > 0
	const status = rawStatus === "supported" && !hasEvidence ? "weakly_supported" : rawStatus
	const limitations = Array.isArray(value.limitations) ? value.limitations.map(String) : []
	if (rawStatus === "supported" && !hasEvidence) {
		limitations.unshift("No evidence spans are linked; panel downgraded this claim for review until evidence is attached.")
	}
	return {
		claimId: String(value.claim_id ?? value.claimId ?? claimId),
		sessionId,
		statement: String(value.statement ?? value.claim ?? ""),
		status,
		claimType: String(value.claim_type ?? value.claimType ?? ""),
		confidence: String(value.confidence ?? ""),
		createdAt: String(value.created_at ?? value.createdAt ?? ""),
		updatedAt: String(value.updated_at ?? value.updatedAt ?? ""),
		evidenceSpans: normalizedSpans,
		limitations,
	}
}

function synthesizeEvidenceCandidates(entries: RunEntry[], sessionId: string): ClaimSurfaceRecord[] {
	return entries.map((entry) => ({
		claimId: `candidate:${entry.run_id}`,
		sessionId,
		statement: `Evidence candidate from ${entry.tool_name}: review outputs before turning this run into a formal scientific claim.`,
		status: "tested",
		claimType: "evidence_candidate",
		confidence: "",
		createdAt: entry.timestamp,
		updatedAt: entry.timestamp,
		evidenceSpans: [
			{
				sourceType: "run",
				sourceId: entry.run_id,
				metricRef: "",
				description: `Tool run ${entry.tool_name}`,
			},
		],
		limitations: ["Auto-generated evidence candidate; not a user-authored scientific claim."],
	}))
}

export async function loadReplaySurface(sessionIdOrPath: string, readSnapshot: SnapshotReader): Promise<ReplaySurface> {
	const snapshot = await readSnapshot(sessionIdOrPath)
	return {
		session_id: snapshot.session_id,
		source: snapshot.source,
		entries: snapshot.runs.map((run) => normalizeRunEntry(run, String(run.run_id), snapshot.session_id)!),
		sessionPath: snapshot.session_path,
		capsule_path: snapshot.source === "capsule" ? path.dirname(snapshot.session_path) : undefined,
		warnings: snapshot.warnings,
		run_log_source: snapshot.run_log_source,
	}
}
