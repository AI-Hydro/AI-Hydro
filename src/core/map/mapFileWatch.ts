/**
 * The map's watcher: a layer that names a file follows that file.
 *
 * A change reaches this module three ways: an event from a watcher, a look at every loaded file when the map opens, and the
 * same look when the panel is shown again (watchers can drop events, and network drives do not promise them). All three run
 * one check, `checkFile`, so a missed event is repaired by the next look and nothing else is needed.
 *
 * What a check does with a file whose size or time differs from the layer's record:
 *   - The layer has no evidence link (`_run_id`, `study_id`, `tool`, `claim_id`): the file is read once and hashed, the
 *     map's page parses exactly those bytes, and the layer is updated in place (id, style, order and the camera stay).
 *   - The layer has an evidence link, or is not a vector layer: the layer is flagged `source_changed` and nothing else
 *     changes. Only `useNewFile`, the user's choice, replaces content under a link.
 *   - The new version cannot be parsed: it is tried once more after a second (a writer may be mid-write), then the layer
 *     says it could not read the new version and keeps the last good copy.
 *   - The file is gone: the layer says so and keeps the last loaded copy. A delete followed at once by a create (an editor
 *     saving by replacing) is waited out, so it never shows as gone.
 *
 * Never: reveal the panel (a check that finds the panel closed waits for the next open), draw a copy that was not made
 * from the bytes that were hashed, or watch a path the map was not allowed to load. This module has no VS Code import; the
 * host hands in the file system, the watchers and the panel.
 */

import * as crypto from "node:crypto"
import * as path from "node:path"
import { hasEvidenceLink, resolvedSourcePath } from "@shared/map/layerIdentity"
import { PROJECT_FILE_EXTENSIONS } from "@shared/map/projectFiles"
import type { FileSnapshot, RefreshOutcome } from "./refreshFromFile"

export interface WatchableLayer {
	id: string
	name?: string
	layerType?: string
	geojson?: string
	metadata?: Record<string, string>
}

export interface FsLike {
	stat(p: string): Promise<{ size: number; mtimeMs: number }>
	readFile(p: string): Promise<Uint8Array>
}

export interface Disposable {
	dispose(): void
}

/** What the host asks the map's page to do: fetch the file, check it is the bytes that were hashed, parse it. */
export interface ParseRequest {
	requestId: string
	layerId: string
	path: string
	name: string
	sizeBytes: number
	mtimeMs: number
	sha256: string
	mode: "auto" | "use_new_file"
}

/** The page's answer. `geojson` and `metadata` are what the parse made of the bytes. */
export interface ParseResult {
	requestId: string
	ok: boolean
	/** Why not: the file changed while it was read, the layer is not a vector layer, or the parser's message. */
	reason?: "changed_while_reading" | "unsupported" | "parse"
	message?: string
	geojson?: string
	metadata?: Record<string, string>
}

export type WatchReport =
	| { kind: "updated"; layerId: string; name: string; priorRun?: string; mode: "auto" | "use_new_file" }
	| { kind: "flagged"; layerId: string; name: string }
	| { kind: "unreadable"; layerId: string; name: string; reason: string }
	| { kind: "missing"; layerId: string; name: string }

export interface MapFileWatchDeps {
	layers(): WatchableLayer[]
	fs: FsLike
	/** The resolved path when the map may load this file (the same check as Add file), else undefined. */
	authorize(absolutePath: string): Promise<string | undefined>
	workspaceFolders(): string[]
	/** A non-recursive watcher on one folder; `onEvent` gets the absolute path of each file that changed, was made or was removed. */
	watchFolder(folder: string, onEvent: (file: string) => void): Disposable | undefined
	/** Raw events for map files inside the open folders (the Project files scanner's watcher). */
	onWorkspaceEvent(listener: (file: string) => void): Disposable
	/** True while the map panel exists. Nothing here ever opens or reveals it. */
	panelOpen(): boolean
	/** Post to the existing panel; false when there is none. */
	requestParse(request: ParseRequest): boolean
	/** Merge into a layer's metadata; an empty value removes the key. */
	patchLayer(layerId: string, metadata: Record<string, string>): void
	applyRefresh(
		layerId: string,
		update: { geojson: string; metadata?: Record<string, string>; snapshot: FileSnapshot; updatedAtIso: string },
		mode: "auto" | "use_new_file",
	): RefreshOutcome
	report(report: WatchReport): void
}

export interface MapFileWatchOptions {
	/** Quiet time after an event before the file is looked at; a writer's burst is one check. */
	debounceMs: number
	/** How long a missing file is waited for before it is called gone (delete then create). */
	missingGraceMs: number
	/** One retry of a version that would not parse. */
	parseRetryMs: number
	/** A look at a file that changed while it was being read. */
	unstableRetryMs: number
	unstableMaxAttempts: number
	/** The page did not answer. */
	requestTimeoutMs: number
	maxFolderWatchers: number
	/** Files above this are never read to be hashed; they can only be flagged. */
	maxHashBytes: number
}

export const DEFAULT_WATCH_OPTIONS: MapFileWatchOptions = {
	debounceMs: 120,
	missingGraceMs: 400,
	parseRetryMs: 1000,
	unstableRetryMs: 150,
	unstableMaxAttempts: 8,
	requestTimeoutMs: 20_000,
	maxFolderWatchers: 50,
	maxHashBytes: 256 * 1024 * 1024,
}

/** Layers of these types hold no file text the map can re-parse in place. */
const NOT_VECTOR_TYPES = new Set(["raster", "inundation_3d", "gee_tile"])
const COVERED_EXTENSIONS = new Set(PROJECT_FILE_EXTENSIONS.map((e) => `.${e}`))
const FLAGGED_STATUSES = new Set(["source_changed", "source_unreadable", "source_missing"])
/** VS Code reports whole milliseconds (a stat floored); the file system reports fractions. Under one millisecond apart is one time. */
const MTIME_TOLERANCE_MS = 1

/** The file a layer names, as one comparable path, or undefined. Remote and generated layers name no file the user edits. */
export function watchedPathOf(layer: WatchableLayer): string | undefined {
	const meta = layer.metadata
	if (!meta || meta.source_remote_url) return undefined
	if (layer.layerType === "inundation_3d" || layer.layerType === "gee_tile") return undefined
	const p = resolvedSourcePath(meta)
	return p && (p.startsWith("/") || /^[A-Za-z]:\//.test(p)) ? p : undefined
}

const numberOf = (v: string | undefined): number | undefined => {
	if (v === undefined || v === "") return undefined
	const n = Number(v)
	return Number.isFinite(n) ? n : undefined
}

const isMissingError = (err: unknown): boolean => {
	const code = (err as { code?: string } | undefined)?.code
	return code === "ENOENT" || code === "ENOTDIR" || code === "FileNotFound" || code === "EntryNotFound"
}

type Verdict = "unchanged" | "changed" | "unknown"

interface StatSnapshot {
	size: number
	mtimeMs: number
}

/** What a layer recorded about its file, against what the file is now. */
function compareRecord(meta: Record<string, string>, now: StatSnapshot): Verdict {
	const size = numberOf(meta.source_size_bytes)
	const mtime = numberOf(meta.source_mtime_ms)
	if (size === undefined && mtime === undefined) return "unknown"
	if (size !== undefined && size !== now.size) return "changed"
	if (mtime !== undefined && Math.abs(mtime - now.mtimeMs) >= MTIME_TOLERANCE_MS) return "changed"
	return "unchanged"
}

/** A flagged layer already said it saw this version. */
function alreadySeen(meta: Record<string, string>, now: StatSnapshot): boolean {
	const size = numberOf(meta.source_seen_size_bytes)
	const mtime = numberOf(meta.source_seen_mtime_ms)
	return size === now.size && mtime !== undefined && Math.abs(mtime - now.mtimeMs) < MTIME_TOLERANCE_MS
}

interface FileState {
	timer?: ReturnType<typeof setTimeout>
	running: boolean
	dirty: boolean
	unstableAttempts: number
	/** Requests the page could not carry out (the file moved under it). Reset by a version that was applied. */
	pageFailures: number
	inflight?: {
		requestId: string
		layerId: string
		mode: "auto" | "use_new_file"
		snapshot: FileSnapshot
		timeout: ReturnType<typeof setTimeout>
	}
	/** The version that would not parse and was retried once, and the version that is known unreadable. */
	retriedSha?: string
	retryTimer?: ReturnType<typeof setTimeout>
	unreadableSha?: string
}

export class MapFileWatch {
	private readonly options: MapFileWatchOptions
	/** Comparable path -> the path the file system knows it by, for every file the map may load and a layer names. */
	private targets = new Map<string, string>()
	private readonly states = new Map<string, FileState>()
	private readonly folderWatchers = new Map<string, Disposable>()
	private workspaceSubscription: Disposable | undefined
	private syncing: Promise<void> = Promise.resolve()
	private disposed = false
	private requestCounter = 0

	constructor(
		private readonly deps: MapFileWatchDeps,
		options: Partial<MapFileWatchOptions> = {},
	) {
		this.options = { ...DEFAULT_WATCH_OPTIONS, ...options }
	}

	/** Start listening to the open folders. Folder watchers follow the layers (`sync`). */
	start(): void {
		this.workspaceSubscription ??= this.deps.onWorkspaceEvent((file) => this.onFileEvent(file))
	}

	dispose(): void {
		this.disposed = true
		this.workspaceSubscription?.dispose()
		this.workspaceSubscription = undefined
		for (const watcher of this.folderWatchers.values()) watcher.dispose()
		this.folderWatchers.clear()
		for (const state of this.states.values()) {
			if (state.timer) clearTimeout(state.timer)
			if (state.retryTimer) clearTimeout(state.retryTimer)
			if (state.inflight) clearTimeout(state.inflight.timeout)
		}
		this.states.clear()
		this.targets.clear()
	}

	/** The panel closed with requests out: they are dropped, not counted as unreadable files. The next open looks again. */
	cancelRequests(): void {
		for (const state of this.states.values()) {
			if (state.inflight) {
				clearTimeout(state.inflight.timeout)
				state.inflight = undefined
			}
			if (state.retryTimer) {
				clearTimeout(state.retryTimer)
				state.retryTimer = undefined
			}
		}
	}

	/** True when nothing is waiting: no timer, no check running, no request out. For tests and for shutdown. */
	isIdle(): boolean {
		for (const state of this.states.values()) {
			if (state.timer || state.retryTimer || state.running || state.inflight) return false
		}
		return true
	}

	/**
	 * Match the watched files and folder watchers to the layers on the map. A path is watched only when the map may load it
	 * (inside an open folder or AI-Hydro's own directories, or a file the user picked this session): a path that arrived in a
	 * map scene or a message is not.
	 */
	sync(): Promise<void> {
		const run = () => this.syncOnce()
		this.syncing = this.syncing.then(run, run)
		return this.syncing
	}

	private async syncOnce(): Promise<void> {
		if (this.disposed) return
		const next = new Map<string, string>()
		for (const layer of this.deps.layers()) {
			const key = watchedPathOf(layer)
			if (!key || next.has(key)) continue
			const real = await this.deps.authorize(key)
			if (!real) continue
			next.set(key, real)
			next.set(this.keyOf(real), real)
		}
		if (this.disposed) return
		this.targets = next
		const wantedFolders = new Set<string>()
		for (const real of new Set(next.values())) {
			if (!this.coveredByWorkspaceWatcher(real)) wantedFolders.add(path.dirname(real))
		}
		for (const [folder, watcher] of this.folderWatchers) {
			if (!wantedFolders.has(folder)) {
				watcher.dispose()
				this.folderWatchers.delete(folder)
			}
		}
		for (const folder of wantedFolders) {
			if (this.folderWatchers.has(folder) || this.folderWatchers.size >= this.options.maxFolderWatchers) continue
			const watcher = this.deps.watchFolder(folder, (file) => this.onFileEvent(file))
			if (watcher) this.folderWatchers.set(folder, watcher)
		}
	}

	private keyOf(p: string): string {
		return resolvedSourcePath({ source_path: p }) ?? p
	}

	private coveredByWorkspaceWatcher(real: string): boolean {
		if (!COVERED_EXTENSIONS.has(path.extname(real).toLowerCase())) return false
		return this.deps.workspaceFolders().some((folder) => {
			const rel = path.relative(folder, real)
			return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
		})
	}

	private stateOf(real: string): FileState {
		let state = this.states.get(real)
		if (!state) {
			state = { running: false, dirty: false, unstableAttempts: 0, pageFailures: 0 }
			this.states.set(real, state)
		}
		return state
	}

	/** A watcher said something happened to a file. Files no layer names are none of the map's business. */
	private onFileEvent(file: string): void {
		const real = this.targets.get(this.keyOf(file))
		if (real) this.schedule(real, this.options.debounceMs, true)
	}

	private schedule(real: string, delayMs: number, fromEvent: boolean): void {
		if (this.disposed) return
		const state = this.stateOf(real)
		if (fromEvent) state.unstableAttempts = 0
		if (state.inflight || state.running) {
			state.dirty = true
			return
		}
		if (state.timer) clearTimeout(state.timer)
		state.timer = setTimeout(() => {
			state.timer = undefined
			void this.run(real, fromEvent)
		}, delayMs)
	}

	private async run(real: string, fromEvent: boolean): Promise<void> {
		const state = this.stateOf(real)
		if (state.running) {
			state.dirty = true
			return
		}
		state.running = true
		try {
			await this.checkFile(real, fromEvent)
		} catch (err) {
			console.warn(`[MapFileWatch] Check of ${real} failed:`, err)
		} finally {
			state.running = false
		}
		if (state.dirty && !state.inflight) {
			state.dirty = false
			this.schedule(real, 0, true)
		}
	}

	/**
	 * Look at every loaded file: when the map opens, when the panel is shown again, and when the user asks. A layer whose
	 * record has no size or time is not touched here (nothing says it differs); only an event can tell for such a layer.
	 */
	async checkAll(): Promise<void> {
		await this.sync()
		const reals = [...new Set(this.targets.values())]
		let next = 0
		const worker = async () => {
			while (next < reals.length) {
				const real = reals[next++]
				await this.run(real, false)
			}
		}
		await Promise.all(Array.from({ length: Math.min(4, reals.length) }, worker))
	}

	private layersAt(real: string): WatchableLayer[] {
		const key = this.keyOf(real)
		return this.deps.layers().filter((layer) => {
			const k = watchedPathOf(layer)
			return !!k && (k === key || this.targets.get(k) === real)
		})
	}

	private async statOrMissing(real: string): Promise<StatSnapshot | undefined> {
		try {
			const st = await this.deps.fs.stat(real)
			return { size: st.size, mtimeMs: st.mtimeMs }
		} catch (err) {
			if (isMissingError(err)) return undefined
			throw err
		}
	}

	/** The file read once: its bytes hashed, and the size and time taken before and after must agree (a writer mid-write does not). */
	private async readStable(real: string): Promise<FileSnapshot | undefined | "unstable"> {
		let before: StatSnapshot
		let bytes: Uint8Array
		let after: StatSnapshot
		try {
			before = await this.deps.fs.stat(real)
			if (before.size > this.options.maxHashBytes) return "unstable"
			bytes = await this.deps.fs.readFile(real)
			after = await this.deps.fs.stat(real)
		} catch (err) {
			if (isMissingError(err)) return undefined
			return "unstable"
		}
		if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== after.size) return "unstable"
		return {
			sizeBytes: after.size,
			mtimeMs: after.mtimeMs,
			sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
		}
	}

	private async checkFile(real: string, fromEvent: boolean): Promise<void> {
		const layers = this.layersAt(real)
		if (layers.length === 0) return
		const state = this.stateOf(real)
		const now = await this.statOrMissing(real)
		if (!now) {
			await this.whenGone(real, layers)
			return
		}

		let snapshot: FileSnapshot | undefined
		let started = false
		for (const layer of layers) {
			const meta = layer.metadata ?? {}
			let verdict = compareRecord(meta, now)
			// An event says something happened. Where the layer holds the hash of what it drew, the hash is the judge: a
			// rewrite with the same size inside the same millisecond does not show in a stat.
			if (verdict === "unchanged" && fromEvent && meta.source_sha256) verdict = "unknown"
			if (verdict === "unchanged") {
				this.clearFlags(layer, meta)
				continue
			}
			if (verdict === "unknown" && !fromEvent) continue
			// A flagged layer that already said it saw this exact version is left alone (no reading every time the panel is shown).
			if (
				FLAGGED_STATUSES.has(meta.source_status ?? "") &&
				alreadySeen(meta, now) &&
				meta.source_status !== "source_missing"
			)
				continue

			if (!snapshot) {
				const read = await this.readStable(real)
				if (read === undefined) {
					await this.whenGone(real, layers)
					return
				}
				if (read === "unstable") {
					if (++state.unstableAttempts < this.options.unstableMaxAttempts)
						this.schedule(real, this.options.unstableRetryMs, false)
					return
				}
				snapshot = read
				state.unstableAttempts = 0
			}
			// Touched, not changed: the bytes are the ones the layer holds.
			if (meta.source_sha256 && meta.source_sha256 === snapshot.sha256) {
				this.deps.patchLayer(layer.id, {
					source_size_bytes: String(snapshot.sizeBytes),
					source_mtime_ms: String(Math.round(snapshot.mtimeMs)),
					...this.clearedFlagPatch(meta),
				})
				continue
			}
			if (this.followsByItself(layer)) {
				if (started) continue // one request at a time per file; the next look takes the others
				if (state.unreadableSha === snapshot.sha256) continue
				if (!this.deps.panelOpen()) continue // waits for the next open; never opens the panel
				started = this.request(real, layer, snapshot, "auto")
			} else {
				this.flagChanged(layer, snapshot)
			}
		}
	}

	/**
	 * A file was not there. Delete-then-create (an editor or a tool saving by replacing) shows as gone for a moment, so it is
	 * waited for before it is called gone: if it comes back, it is looked at again as if an event had said so.
	 */
	private async whenGone(real: string, layers: WatchableLayer[]): Promise<void> {
		await new Promise((resolve) => setTimeout(resolve, this.options.missingGraceMs))
		if (this.disposed) return
		if (await this.statOrMissing(real)) {
			this.schedule(real, 0, true)
			return
		}
		this.flagMissing(layers)
	}

	/** True for a vector layer with no evidence link: its file is the layer, so the layer follows the file. */
	private followsByItself(layer: WatchableLayer): boolean {
		return !hasEvidenceLink(layer.metadata) && !NOT_VECTOR_TYPES.has(layer.layerType ?? "")
	}

	private nameOf(layer: WatchableLayer): string {
		return layer.metadata?.display_name || layer.name || layer.id
	}

	private clearedFlagPatch(meta: Record<string, string>): Record<string, string> {
		if (!FLAGGED_STATUSES.has(meta.source_status ?? "")) return {}
		return {
			source_status: "current",
			source_seen_size_bytes: "",
			source_seen_mtime_ms: "",
			source_seen_sha256: "",
			source_error: "",
		}
	}

	private clearFlags(layer: WatchableLayer, meta: Record<string, string>): void {
		const patch = this.clearedFlagPatch(meta)
		if (Object.keys(patch).length > 0) this.deps.patchLayer(layer.id, patch)
	}

	private flagChanged(layer: WatchableLayer, snapshot: FileSnapshot): void {
		const meta = layer.metadata ?? {}
		if (meta.source_status === "source_changed" && meta.source_seen_sha256 === snapshot.sha256) return
		this.deps.patchLayer(layer.id, {
			source_status: "source_changed",
			source_seen_size_bytes: String(snapshot.sizeBytes),
			source_seen_mtime_ms: String(Math.round(snapshot.mtimeMs)),
			source_seen_sha256: snapshot.sha256,
			source_error: "",
		})
		this.deps.report({ kind: "flagged", layerId: layer.id, name: this.nameOf(layer) })
	}

	/** A layer that names a file the tools did not make says when the file is gone; a tool's layer has its own saved copy. */
	private flagMissing(layers: WatchableLayer[]): void {
		for (const layer of layers) {
			const meta = layer.metadata ?? {}
			if (meta.tool || meta._run_id || meta.source_status === "source_missing") continue
			this.deps.patchLayer(layer.id, { source_status: "source_missing" })
			this.deps.report({ kind: "missing", layerId: layer.id, name: this.nameOf(layer) })
		}
	}

	private request(real: string, layer: WatchableLayer, snapshot: FileSnapshot, mode: "auto" | "use_new_file"): boolean {
		const requestId = `mfw-${++this.requestCounter}-${Date.now().toString(36)}`
		const state = this.stateOf(real)
		const sent = this.deps.requestParse({
			requestId,
			layerId: layer.id,
			path: real,
			name: path.basename(real),
			sizeBytes: snapshot.sizeBytes,
			mtimeMs: snapshot.mtimeMs,
			sha256: snapshot.sha256,
			mode,
		})
		if (!sent) return false
		state.inflight = {
			requestId,
			layerId: layer.id,
			mode,
			snapshot,
			timeout: setTimeout(() => {
				if (!this.deps.panelOpen()) {
					this.cancelRequests()
					return
				}
				this.onParseResult({ requestId, ok: false, reason: "parse", message: "The map did not answer." })
			}, this.options.requestTimeoutMs),
		}
		return true
	}

	/**
	 * The user chose `Use new file` for a layer that follows nothing by itself. Reads the file now and has the page parse it;
	 * the link is removed with the content it vouched for (see `refreshLayerFromFile`). Resolves with why not, if not.
	 */
	async useNewFile(layerId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
		await this.sync()
		const layer = this.deps.layers().find((l) => l.id === layerId)
		const key = layer ? watchedPathOf(layer) : undefined
		const real = key ? this.targets.get(key) : undefined
		if (!layer || !real) return { ok: false, reason: "That layer does not name a file the map may read." }
		if (NOT_VECTOR_TYPES.has(layer.layerType ?? ""))
			return { ok: false, reason: "This kind of layer cannot be replaced in place. Remove it and load the file again." }
		if (!this.deps.panelOpen()) return { ok: false, reason: "The map is not open." }
		const state = this.stateOf(real)
		if (state.inflight) return { ok: false, reason: "The file is being read. Try again in a moment." }
		const snapshot = await this.readStable(real)
		if (snapshot === undefined) return { ok: false, reason: "File not found." }
		if (snapshot === "unstable") return { ok: false, reason: "The file is changing. Try again in a moment." }
		return this.request(real, layer, snapshot, "use_new_file") ? { ok: true } : { ok: false, reason: "The map is not open." }
	}

	/** The page's answer to a `ParseRequest`. */
	onParseResult(result: ParseResult & { geojson?: string }): void {
		for (const [real, state] of this.states) {
			const inflight = state.inflight
			if (!inflight || inflight.requestId !== result.requestId) continue
			clearTimeout(inflight.timeout)
			state.inflight = undefined
			const layer = this.deps.layers().find((l) => l.id === inflight.layerId)
			if (layer) this.finish(real, state, layer, inflight, result)
			if (state.dirty) {
				state.dirty = false
				this.schedule(real, 0, true)
			}
			return
		}
	}

	private finish(
		real: string,
		state: FileState,
		layer: WatchableLayer,
		inflight: NonNullable<FileState["inflight"]>,
		result: ParseResult,
	): void {
		const name = this.nameOf(layer)
		if (result.ok && result.geojson) {
			const outcome = this.deps.applyRefresh(
				layer.id,
				{
					geojson: result.geojson,
					metadata: result.metadata,
					snapshot: inflight.snapshot,
					updatedAtIso: new Date().toISOString(),
				},
				inflight.mode,
			)
			if (outcome.ok) {
				state.retriedSha = undefined
				state.unreadableSha = undefined
				state.pageFailures = 0
				this.deps.report({ kind: "updated", layerId: layer.id, name, priorRun: outcome.priorRun, mode: inflight.mode })
				// Other layers on the same file are looked at next.
				this.schedule(real, 0, true)
				return
			}
			// Refused: the layer gained a link since the request went out. It is flagged, not changed.
			this.flagChanged(layer, inflight.snapshot)
			return
		}
		if (result.reason === "changed_while_reading" && ++state.pageFailures < this.options.unstableMaxAttempts) {
			this.schedule(real, this.options.unstableRetryMs, false)
			return
		}
		if (result.reason === "unsupported") {
			this.flagChanged(layer, inflight.snapshot)
			return
		}
		// The new version would not parse. A writer can be part-way through a file, so once more after a second, then say so.
		const sha = inflight.snapshot.sha256
		if (inflight.mode === "auto" && state.retriedSha !== sha) {
			state.retriedSha = sha
			if (state.retryTimer) clearTimeout(state.retryTimer)
			state.retryTimer = setTimeout(() => {
				state.retryTimer = undefined
				this.schedule(real, 0, true)
			}, this.options.parseRetryMs)
			return
		}
		state.unreadableSha = sha
		const reason = result.message || "The file could not be read as a map layer."
		this.deps.patchLayer(layer.id, {
			source_status: "source_unreadable",
			source_error: reason.slice(0, 300),
			source_seen_size_bytes: String(inflight.snapshot.sizeBytes),
			source_seen_mtime_ms: String(Math.round(inflight.snapshot.mtimeMs)),
			source_seen_sha256: sha,
		})
		this.deps.report({ kind: "unreadable", layerId: layer.id, name, reason })
	}
}

/** A restored layer's record against its file: true when the file has changed since the layer was made. Used at restore. */
export function fileChangedSinceRecord(meta: Record<string, string>, now: { size: number; mtimeMs: number }): boolean {
	return compareRecord(meta, now) === "changed"
}
