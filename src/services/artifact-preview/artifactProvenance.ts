import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import type { RunArtifactCodeResult } from "./ArtifactKernelService"

/**
 * One record per Studio cell run, written to `.aihydro/runs/<id>.json`.
 *
 * Studio runs execute in a local kernel the server never sees, so every record
 * says `recording: "practice-not-server-recorded"` (ADR-008 invariant 4). The
 * code text is stored beside its hash so a record is replayable, not just
 * verifiable against a copy someone else must still hold.
 */
export interface CellProvenanceRecord {
	artifactId: string
	cellId: string
	codeHash: string
	codeText: string
	pythonExecutable: string
	pythonVersion: string
	/** sha256 of the sorted `name==version` list the kernel reported; empty if unavailable. */
	packagesDigest: string
	cwd: string
	profileId: string
	startedAt: string
	durationMs: number
	status: string
	outputDigests: OutputDigests
	recording: "practice-not-server-recorded"
}

export interface OutputDigests {
	stdout: string
	stderr: string
	resultRepr: string
	imagesPng: string[]
}

function runsDir(workspaceFolder: string): string {
	return path.join(workspaceFolder, ".aihydro", "runs")
}

export function hashCode(code: string): string {
	return `sha256:${createHash("sha256").update(code, "utf8").digest("hex")}`
}

export function hashOutputs(result: RunArtifactCodeResult): OutputDigests {
	return {
		stdout: hashCode(result.stdout),
		stderr: hashCode(result.stderr),
		resultRepr: hashCode(result.resultRepr),
		imagesPng: result.imagesPngBase64.map((b64) => `sha256:${createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex")}`),
	}
}

export async function writeCellProvenance(
	workspaceFolder: string | null,
	record: CellProvenanceRecord,
): Promise<string | undefined> {
	if (!workspaceFolder) {
		return undefined
	}
	const dir = runsDir(workspaceFolder)
	await fs.promises.mkdir(dir, { recursive: true })
	const id = `${record.artifactId}_${record.cellId}_${Date.now()}`
	const filePath = path.join(dir, `${id}.json`)
	await fs.promises.writeFile(filePath, JSON.stringify(record, null, 2), "utf8")
	return id
}

export function mapResultStatus(result: RunArtifactCodeResult): string {
	if (result.status === "ok") {
		return "success"
	}
	return result.status
}
