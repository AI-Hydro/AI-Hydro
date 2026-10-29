import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { HistoryItem } from "@shared/HistoryItem"

/**
 * M1: give existing chats a `projectId` (X1-P1).
 *
 * A project is a workspace folder, so a chat is placed by the folder it was started in. Two things on a stored item
 * name one, and they are used in this order:
 *
 *  1. `cwdOnTaskInitialization`: a creation field, written once (first value wins) since X0-1. An item saved by an
 *     older build may hold the folder at its last save instead; that is the lossy part for chats whose window moved.
 *  2. `shadowGitConfigWorkTree`: only when the first is absent. It is a loop field, rewritten on every save, so it is
 *     the LATEST checkpoint folder, not the earliest; it is a fallback, never preferred.
 *
 * What cannot be placed stays out of any project ("Unsorted", an item with no `projectId`): a chat with no folder
 * recorded, or whose folder no longer exists on disk. This is lossy by design. A chat started in a folder that was
 * later moved or deleted is not guessed into another project; it can be attached by hand once the project registry
 * offers that. Nothing is deleted or rewritten except the one new field.
 *
 * Idempotent: an item that has a `projectId` is never looked at again, an Unsorted item stays Unsorted, and a plan
 * with nothing to assign makes no server call. A run that fails part way leaves the failed folders unassigned for the
 * next activation. The server's `ensure_project` is itself idempotent per folder.
 *
 * This module is pure (the folder check and the server call are passed in), so a dry run can read a copy of
 * `taskHistory.json` and report the counts without creating any project.
 */

export type DirSource = "cwd" | "checkpoint"

/** The folder an item was started in (`cwdOnTaskInitialization` first), and which field said so. Relative or empty values are not folders. */
export function earliestKnownDir(item: HistoryItem): { dir: string; source: DirSource } | undefined {
	const candidates: Array<[string | undefined, DirSource]> = [
		[item.cwdOnTaskInitialization, "cwd"],
		[item.shadowGitConfigWorkTree, "checkpoint"],
	]
	for (const [raw, source] of candidates) {
		if (typeof raw === "string" && path.isAbsolute(raw.trim())) {
			return { dir: path.resolve(raw.trim()), source }
		}
	}
	return undefined
}

export interface ProjectMigrationPlan {
	total: number
	/** Items that already have a `projectId`: left alone. */
	alreadyAssigned: number
	/** One entry per distinct folder that exists: the items to put in its project. */
	byDir: Array<{ dir: string; itemIds: string[] }>
	/** Unsorted: no folder was recorded. */
	noDir: string[]
	/** Unsorted: a folder was recorded but is gone (moved or deleted). */
	missingDir: string[]
}

export async function planProjectMigration(
	history: readonly HistoryItem[],
	dirExists: (dir: string) => Promise<boolean>,
): Promise<ProjectMigrationPlan> {
	const plan: ProjectMigrationPlan = { total: history.length, alreadyAssigned: 0, byDir: [], noDir: [], missingDir: [] }
	const groups = new Map<string, string[]>()
	const present = new Map<string, boolean>()
	for (const item of history) {
		if (item.projectId) {
			plan.alreadyAssigned++
			continue
		}
		const known = earliestKnownDir(item)
		if (!known) {
			plan.noDir.push(item.id)
			continue
		}
		if (!present.has(known.dir)) {
			present.set(known.dir, await dirExists(known.dir).catch(() => false))
		}
		if (!present.get(known.dir)) {
			plan.missingDir.push(item.id)
			continue
		}
		const ids = groups.get(known.dir) ?? []
		ids.push(item.id)
		groups.set(known.dir, ids)
	}
	plan.byDir = [...groups.entries()].map(([dir, itemIds]) => ({ dir, itemIds }))
	return plan
}

export interface ProjectMigrationSummary {
	total: number
	alreadyAssigned: number
	wouldAssign: number
	/** Distinct folders (= projects the server would be asked for). Folder names only, never a chat title. */
	projects: Array<{ folder: string; chats: number }>
	unsorted: { noFolderRecorded: number; folderMissing: number; total: number }
}

/** Counts only: the folder's own name, never a path or a chat title. */
export function summarizePlan(plan: ProjectMigrationPlan): ProjectMigrationSummary {
	const projects = plan.byDir
		.map((g) => ({ folder: path.basename(g.dir) || g.dir, chats: g.itemIds.length }))
		.sort((a, b) => b.chats - a.chats || a.folder.localeCompare(b.folder))
	return {
		total: plan.total,
		alreadyAssigned: plan.alreadyAssigned,
		wouldAssign: plan.byDir.reduce((n, g) => n + g.itemIds.length, 0),
		projects,
		unsorted: {
			noFolderRecorded: plan.noDir.length,
			folderMissing: plan.missingDir.length,
			total: plan.noDir.length + plan.missingDir.length,
		},
	}
}

export type EnsureForMigration = (
	dir: string,
) => Promise<{ ok: true; projectId: string } | { ok: false; code: string; reason: string }>

export interface ProjectMigrationResult {
	assignments: Array<{ itemId: string; projectId: string }>
	/** Folders whose project could not be made now; their chats stay unassigned and are retried next activation. */
	failed: Array<{ folder: string; chats: number; code: string; reason: string }>
	/** The run stopped early because the server is absent or too old: no further call was made. */
	stoppedEarly: boolean
}

/** Ask the server for one project per folder. Stops at the first "no server" / "server too old". Never throws. */
export async function resolveProjects(plan: ProjectMigrationPlan, ensure: EnsureForMigration): Promise<ProjectMigrationResult> {
	const result: ProjectMigrationResult = { assignments: [], failed: [], stoppedEarly: false }
	for (const group of plan.byDir) {
		if (result.stoppedEarly) {
			result.failed.push({
				folder: path.basename(group.dir) || group.dir,
				chats: group.itemIds.length,
				code: "SKIPPED",
				reason: "An earlier folder showed the server is unavailable.",
			})
			continue
		}
		let r: Awaited<ReturnType<EnsureForMigration>>
		try {
			r = await ensure(group.dir)
		} catch (error) {
			r = { ok: false, code: "FAILED", reason: error instanceof Error ? error.message : String(error) }
		}
		if (r.ok) {
			for (const itemId of group.itemIds) {
				result.assignments.push({ itemId, projectId: r.projectId })
			}
			continue
		}
		result.failed.push({
			folder: path.basename(group.dir) || group.dir,
			chats: group.itemIds.length,
			code: r.code,
			reason: r.reason,
		})
		if (r.code === "NO_SERVER" || r.code === "OLD_SERVER") {
			result.stoppedEarly = true
		}
	}
	return result
}

/** The one-time notice after a run that placed chats. It states what is lost. */
export function describeMigration(plan: ProjectMigrationPlan, result: ProjectMigrationResult): string {
	const unsorted = plan.noDir.length + plan.missingDir.length
	const projects = new Set(result.assignments.map((a) => a.projectId)).size
	const placed = `${result.assignments.length} earlier chat${result.assignments.length === 1 ? "" : "s"} grouped into ${projects} project${projects === 1 ? "" : "s"} by the folder they were started in.`
	const left =
		unsorted > 0
			? ` ${unsorted} stay in Unsorted: their folder was not recorded or no longer exists (a chat whose folder was moved cannot be placed automatically).`
			: ""
	return placed + left
}

const BACKUP_PREFIX = "bak-pre-projects-"

/**
 * One backup of `taskHistory.json` before M1 writes anything: `taskHistory.json.bak-pre-projects-<UTC timestamp>`, beside
 * the original. Written once and never overwritten: if any such file exists already, nothing is done. `created` tells
 * the caller this run took it (the first run that writes). Throws if the copy fails, so M1 writes nothing it could not
 * undo. A history file that does not exist yet has nothing to back up.
 */
export async function backupHistoryOnce(
	historyFile: string,
	now: Date = new Date(),
): Promise<{ created: boolean; backup?: string }> {
	const dir = path.dirname(historyFile)
	const base = path.basename(historyFile)
	const existing = (await fs.readdir(dir).catch(() => [] as string[])).find((f) => f.startsWith(`${base}.${BACKUP_PREFIX}`))
	if (existing) {
		return { created: false, backup: path.join(dir, existing) }
	}
	const backup = path.join(dir, `${base}.${BACKUP_PREFIX}${now.toISOString().replace(/[:.]/g, "-")}`)
	let bytes: Buffer
	try {
		bytes = await fs.readFile(historyFile)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { created: false }
		}
		throw error
	}
	// Exclusive create ("wx") instead of copyFile(COPYFILE_EXCL): that fails with EPERM on Windows runners. A
	// partial file from a failed write is removed so it cannot pass for a backup next time.
	try {
		await fs.writeFile(backup, bytes, { flag: "wx" })
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
			await fs.rm(backup, { force: true }).catch(() => {})
		}
		throw error
	}
	return { created: true, backup }
}
