/** Backend-owned storage contract. The extension never opens a run-log database. */
export const RESEARCH_SNAPSHOT_TEMPLATE = "aihydro://research/snapshot/{reference}"

export interface ResearchSnapshot {
	schema_version: 1
	session_id: string
	session_path: string
	source: "session" | "capsule"
	run_log_source: "sqlite" | "legacy_json" | "capsule_json" | "absent"
	claims: Record<string, unknown>
	experiments: Record<string, unknown>
	runs: Record<string, unknown>[]
	warnings: string[]
}

export interface SnapshotBackend {
	getServers(): {
		name: string
		status: string
		disabled?: boolean
		resourceTemplates?: { uriTemplate: string }[]
	}[]
	readResource(serverName: string, uri: string): Promise<{ contents: { uri: string; text?: string }[] }>
}

export type SnapshotReader = (reference: string) => Promise<ResearchSnapshot>

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value)
}

export function parseResearchSnapshot(text: string): ResearchSnapshot {
	const value: unknown = JSON.parse(text)
	if (isRecord(value) && value.error) {
		throw new Error(`${value.code || "RESEARCH_SNAPSHOT_FAILED"}: ${value.message || "Snapshot unavailable"}`)
	}
	if (
		!isRecord(value) ||
		value.schema_version !== 1 ||
		typeof value.session_id !== "string" ||
		!value.session_id ||
		typeof value.session_path !== "string" ||
		!["session", "capsule"].includes(String(value.source)) ||
		!["sqlite", "legacy_json", "capsule_json", "absent"].includes(String(value.run_log_source)) ||
		!isRecord(value.claims) ||
		!isRecord(value.experiments) ||
		!Array.isArray(value.runs) ||
		!Array.isArray(value.warnings) ||
		!value.warnings.every((warning) => typeof warning === "string")
	) {
		throw new Error("Incompatible research snapshot. Update/restart the AI-Hydro backend and extension together.")
	}
	const ids = new Set<string>()
	for (const run of value.runs) {
		if (
			!isRecord(run) ||
			typeof run.run_id !== "string" ||
			!run.run_id ||
			ids.has(run.run_id) ||
			run.session_id !== value.session_id ||
			typeof run.tool_name !== "string" ||
			typeof run.timestamp !== "string" ||
			!isRecord(run.key_outputs)
		) {
			throw new Error("Invalid persisted run identity or record in research snapshot.")
		}
		ids.add(run.run_id)
	}
	return value as unknown as ResearchSnapshot
}

// Share concurrent panel reads, but never cache a completed snapshot as fresh.
const pending = new WeakMap<SnapshotBackend, Map<string, Promise<ResearchSnapshot>>>()

export function readResearchSnapshot(backend: SnapshotBackend, reference: string): Promise<ResearchSnapshot> {
	let requests = pending.get(backend)
	if (!requests) {
		requests = new Map()
		pending.set(backend, requests)
	}
	const existing = requests.get(reference)
	if (existing) return existing
	const request = (async () => {
		const servers = backend
			.getServers()
			.filter(
				(server) =>
					!server.disabled &&
					server.status === "connected" &&
					server.resourceTemplates?.some((template) => template.uriTemplate === RESEARCH_SNAPSHOT_TEMPLATE),
			)
		if (servers.length !== 1) {
			throw new Error(
				servers.length > 1
					? "Multiple AI-Hydro research backends are connected. Keep one active to identify the authoritative session store."
					: "Research history is unavailable. Connect or restart an updated AI-Hydro backend in MCP settings.",
			)
		}
		const encoded = Buffer.from(reference, "utf8").toString("base64url")
		const uri = RESEARCH_SNAPSHOT_TEMPLATE.replace("{reference}", encoded)
		let timer: ReturnType<typeof setTimeout> | undefined
		const response = await Promise.race([
			backend.readResource(servers[0].name, uri),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("Research snapshot timed out. Check the backend connection and retry.")),
					15_000,
				)
			}),
		]).finally(() => {
			if (timer) clearTimeout(timer)
		})
		const contents = response.contents.filter((item) => item.uri === uri && typeof item.text === "string")
		if (contents.length !== 1) throw new Error("Backend returned no unique matching research snapshot resource.")
		return parseResearchSnapshot(contents[0].text!)
	})().finally(() => requests!.delete(reference))
	requests.set(reference, request)
	return request
}

/** Separate lanes let experiment comparisons load without replacing the primary view. */
export class LatestResearchRequest {
	private versions = new Map<string, number>()
	start(lane = "primary"): () => boolean {
		const version = (this.versions.get(lane) ?? 0) + 1
		this.versions.set(lane, version)
		return () => this.versions.get(lane) === version
	}
}
