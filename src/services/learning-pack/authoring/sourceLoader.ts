/**
 * Filesystem side of the builder: read the course sources into memory with every file confined to a root,
 * and read provenance (commit, dirty flag, timestamp) from git. Nothing is written here.
 */

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { parseStrictJsonSource } from "../canonicalJson"
import { LEARNING_PACK_ARCHIVE_LIMITS } from "../inspectLearningPackArchive"
import { PackBuildError, type SourceBundle } from "./buildPack"
import type { PackConfig } from "./packConfig"

function contained(candidate: string, parent: string): boolean {
	const relative = path.relative(parent, candidate)
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

/**
 * Read one regular file that lives inside `root`. Refuses a symlink (the file itself or any parent that
 * resolves outside the root), a non-file and anything over the contract's per-file limit.
 */
export async function readContainedFile(root: string, relativePath: string, label: string): Promise<Buffer> {
	const realRoot = await fs.realpath(root)
	const lexical = path.resolve(root, relativePath)
	if (!contained(lexical, path.resolve(root))) {
		throw new PackBuildError(
			`${label}: "${relativePath}" is outside the source root ${root} (use --root to widen it deliberately)`,
		)
	}
	let stat: Awaited<ReturnType<typeof fs.lstat>>
	try {
		stat = await fs.lstat(lexical)
	} catch {
		throw new PackBuildError(`${label}: "${relativePath}" does not exist`)
	}
	if (stat.isSymbolicLink()) throw new PackBuildError(`${label}: "${relativePath}" is a symbolic link; refusing to follow it`)
	if (!stat.isFile()) throw new PackBuildError(`${label}: "${relativePath}" is not a regular file`)
	if (!contained(await fs.realpath(lexical), realRoot)) {
		throw new PackBuildError(`${label}: "${relativePath}" resolves outside the source root`)
	}
	if (stat.size > LEARNING_PACK_ARCHIVE_LIMITS.fileBytes) {
		throw new PackBuildError(`${label}: "${relativePath}" exceeds the 64 MiB per-file limit`)
	}
	return fs.readFile(lexical)
}

export interface LoadSourcesInput {
	courseDir: string
	/** Every source file must live under this directory; defaults to the course directory. */
	rootDir: string
	config: PackConfig
}

/** Load `course.json`, every module it lists, and the configured extra files. */
export async function loadSources({ courseDir, rootDir, config }: LoadSourcesInput): Promise<SourceBundle> {
	const courseBytes = await readContainedFile(courseDir, "course.json", "source course.json")
	let course: unknown
	try {
		course = parseStrictJsonSource(courseBytes, "source course.json")
	} catch (error) {
		throw new PackBuildError(error instanceof Error ? error.message : String(error))
	}
	const modules = new Map<string, Uint8Array>()
	const sourceFiles = new Map<string, Uint8Array>([[path.resolve(courseDir, "course.json"), courseBytes]])
	const listed = (course as { modules?: unknown }).modules
	if (Array.isArray(listed)) {
		for (const entry of listed as { id?: unknown; path?: unknown }[]) {
			if (typeof entry?.id !== "string" || typeof entry.path !== "string") continue
			const absolute = path.resolve(courseDir, entry.path)
			const bytes = await readContainedFile(rootDir, path.relative(rootDir, absolute), `module ${entry.id}`)
			modules.set(entry.id, bytes)
			sourceFiles.set(absolute, bytes)
		}
	}
	const extraFiles = new Map<string, Uint8Array>()
	for (const { source, dest } of config.files) {
		const bytes = await readContainedFile(rootDir, source, `files[${dest}]`)
		extraFiles.set(dest, bytes)
		sourceFiles.set(path.resolve(rootDir, source), bytes)
	}
	return { course, modules, extraFiles, sourceFiles }
}

export interface SourceProvenance {
	sourceCommit: string
	/** null = unknown: not in a git work tree, or the recorded commit is not HEAD. Never claims "clean" without checking. */
	sourceDirty: boolean | null
	generatedAt: string
}

function git(cwd: string, args: string[]): { ok: boolean; stdout: string } {
	// Never read the repo's own config for anything that can run a program.
	const result = spawnSync("git", ["-c", "core.fsmonitor=false", "-c", "core.pager=cat", ...args], {
		cwd,
		// File names are literal: `x[12].csv` must never match a tracked `x1.csv` (pathspec globbing).
		env: { ...process.env, GIT_LITERAL_PATHSPECS: "1" },
		encoding: "utf8",
		shell: false,
		maxBuffer: 16 * 1024 * 1024,
	})
	return { ok: result.status === 0, stdout: result.stdout ?? "" }
}

/**
 * Commit, dirty flag and build time. `generatedAt` is SOURCE_DATE_EPOCH when set, else the commit time, so a
 * rebuild of the same commit reproduces the same bytes. A release build refuses a dirty tree.
 */
export function readSourceProvenance(
	rootDir: string,
	options: { buildKind: "release" | "development"; env: NodeJS.ProcessEnv; sourceCommitOverride?: string },
): SourceProvenance {
	let commit = options.sourceCommitOverride
	let dirty: boolean | null = null
	let commitTime: number | undefined
	const head = git(rootDir, ["rev-parse", "HEAD"])
	if (head.ok) {
		const headCommit = head.stdout.trim()
		if (options.buildKind === "release" && commit !== undefined && commit !== headCommit) {
			throw new PackBuildError(`A release build records HEAD (${headCommit}); --source-commit ${commit} is not HEAD`)
		}
		commit ??= headCommit
		// The tree state describes HEAD only; for any other commit it is unknown.
		if (commit === headCommit) {
			// Ignored files are not listed here; a release build checks each included file with `ls-files` instead.
			const status = git(rootDir, ["status", "--porcelain", "--untracked-files=all"])
			dirty = !status.ok || status.stdout.trim().length > 0
		}
		const time = git(rootDir, ["show", "-s", "--format=%ct", commit])
		if (time.ok && /^\d+$/.test(time.stdout.trim())) commitTime = Number(time.stdout.trim())
	} else if (options.buildKind === "release") {
		throw new PackBuildError(`A release build needs ${rootDir} to be inside a git work tree`)
	}
	if (options.buildKind === "release" && dirty !== false) {
		throw new PackBuildError("A release build needs a clean git work tree (commit your changes first)")
	}
	if (!commit) {
		throw new PackBuildError(`${rootDir} is not in a git work tree; pass --source-commit <40-hex> for a development build`)
	}
	if (!/^[0-9a-f]{40}$/.test(commit)) throw new PackBuildError("--source-commit must be a full lowercase 40-hex Git SHA")
	const configured = options.env.SOURCE_DATE_EPOCH
	let epoch: number
	if (configured !== undefined) {
		if (!/^\d+$/.test(configured)) throw new PackBuildError("SOURCE_DATE_EPOCH must be an integer")
		epoch = Number(configured)
		if (epoch < 315532800) throw new PackBuildError("SOURCE_DATE_EPOCH must be at or after 1980-01-01")
	} else if (commitTime !== undefined) {
		epoch = commitTime
	} else {
		throw new PackBuildError("Cannot determine a build time: set SOURCE_DATE_EPOCH (no commit time available)")
	}
	return {
		sourceCommit: commit,
		sourceDirty: dirty,
		generatedAt: new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
	}
}

/** The git blob ID of these exact bytes (what `git hash-object` would print with no filters). */
export function gitBlobId(bytes: Uint8Array): string {
	return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex")
}

/**
 * For a release build: every source file that goes into the pack must be tracked by git AND its bytes must be
 * exactly the blob committed at HEAD. The byte comparison does not trust the index or the work-tree status, so
 * `--assume-unchanged`, `--skip-worktree`, line-ending filters and any future dirty-state gap cannot let bytes
 * ship under a commit that does not contain them.
 */
export function assertSourcesMatchCommit(rootDir: string, sourceFiles: ReadonlyMap<string, Uint8Array>): void {
	const prefix = git(rootDir, ["rev-parse", "--show-prefix"]).stdout.trim()
	for (const [file, bytes] of sourceFiles) {
		const relative = path.relative(rootDir, file).split(path.sep).join("/")
		const tracked = git(rootDir, ["ls-files", "--error-unmatch", "--", relative])
		if (!tracked.ok) {
			throw new PackBuildError(
				`A release build may only include files tracked by git; not tracked (untracked or ignored): ${relative}`,
			)
		}
		const committed = git(rootDir, ["rev-parse", "--verify", "--quiet", `HEAD:${prefix}${relative}`])
		if (!committed.ok || committed.stdout.trim() !== gitBlobId(bytes)) {
			throw new PackBuildError(
				`A release build may only include bytes committed at HEAD; ${relative} differs from the committed file (edited, line-ending filter, or not in HEAD)`,
			)
		}
	}
}
