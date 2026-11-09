/**
 * Host side of the local MERIT-Basins river tiles (basemap slice B2): which archives the map may read, and the byte-range
 * reads the webview asks for.
 *
 * Why the host reads the bytes instead of the webview fetching a file URI: VS Code honoured `Range` for webview resources
 * only from 1.118 (before that a "206" carried the whole file), the extension's engine floor is 1.84, and a host handler is
 * testable without VS Code. The webview names an archive by id (`rivers72`) and never sends a path; the host maps ids to
 * files it has itself validated, so a request can read only bytes of those files.
 *
 * Pure Node (no `vscode` import), so mocha tests it directly.
 */

import { aihydroHome } from "@shared/aihydro/aihydroHome"
import {
	checkRangeRequest,
	checkSidecar,
	MERIT_ARCHIVE_FILE_RE,
	MERIT_ARCHIVE_ID_RE,
	MERIT_LAYER_NAMES,
	MERIT_MSG,
	MERIT_ROOT_ENV_VARS,
	MERIT_SIDECAR_SUFFIX,
	MERIT_TILES_SUBDIR,
	type MeritArchiveOffer,
	type MeritArchivesMessage,
	meritInvalidProvenanceNote,
} from "@shared/map/meritTileContract"
import { createHash } from "crypto"
import * as fs from "fs"
import * as path from "path"

/** The tiles directory, resolved as the builder does (`merit_rivers.merit_root`): the env vars first, else `<AIHYDRO_HOME>/merit`. */
export function meritTilesDir(env: NodeJS.ProcessEnv = process.env): string {
	for (const name of MERIT_ROOT_ENV_VARS) {
		const value = env[name]
		if (value) return path.join(value, MERIT_TILES_SUBDIR)
	}
	return path.join(aihydroHome(env), "merit", MERIT_TILES_SUBDIR)
}

const SIDECAR_MAX_BYTES = 1024 * 1024
const PMTILES_HEADER_BYTES = 127

interface PmtilesHeader {
	minZoom: number
	maxZoom: number
	bounds: [number, number, number, number]
}

/** Reads the PMTiles v3 header; refuses anything that is not a v3 archive of vector (MVT) tiles. */
export function parsePmtilesHeader(buf: Uint8Array): PmtilesHeader | string {
	if (buf.length < PMTILES_HEADER_BYTES) return "file is shorter than a PMTiles header"
	if (Buffer.from(buf.subarray(0, 7)).toString("latin1") !== "PMTiles") return "not a PMTiles file"
	if (buf[7] !== 3) return `PMTiles version ${buf[7]} is not 3`
	if (buf[99] !== 1) return "tiles are not Mapbox Vector Tiles"
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
	const e7 = (at: number) => view.getInt32(at, true) / 1e7
	return { minZoom: buf[100], maxZoom: buf[101], bounds: [e7(102), e7(106), e7(110), e7(114)] }
}

interface Entry {
	id: string
	file: string
	size: number
	mtimeMs: number
	offer: MeritArchiveOffer
}

export interface MeritRegistryOptions {
	tilesDir: () => string
	/** Called when the offered set changes without a scan (a background hash finished). */
	onChange?: () => void
	/** Injectable for tests; the default streams the file through sha256. */
	hashFile?: (file: string) => Promise<string>
}

export function sha256OfFile(file: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha256")
		fs.createReadStream(file)
			.on("data", (chunk) => hash.update(chunk))
			.on("error", reject)
			.on("end", () => resolve(hash.digest("hex")))
	})
}

type HashState = "pending" | "ok" | "mismatch" | "error"

export class MeritArchiveRegistry {
	private entries = new Map<string, Entry>()
	private notes: string[] = []
	/** Keyed by path, size and mtime: a changed file is hashed again. */
	private hashes = new Map<string, HashState>()
	private pendingHashes = new Set<Promise<void>>()
	constructor(private readonly options: MeritRegistryOptions) {}

	/** What is offered now. Cheap: no disk access. */
	snapshot(): MeritArchivesMessage {
		return {
			type: MERIT_MSG.archives,
			archives: [...this.entries.values()].map((e) => ({ ...e.offer })).sort((a, b) => a.id.localeCompare(b.id)),
			notes: [...this.notes],
		}
	}

	/**
	 * Looks at the tiles directory and rebuilds the offered set. An archive is offered only when it is a regular file
	 * (no symlink, real path inside the directory), its sidecar is a regular file and valid for it, its size matches
	 * the record, and the credit line carries the NC-SA words. A sha256 check then runs in the background: a match
	 * upgrades the archive to "sha256-verified", a mismatch withdraws it.
	 */
	async scan(): Promise<MeritArchivesMessage> {
		const next = new Map<string, Entry>()
		const notes: string[] = []
		const dir = this.options.tilesDir()
		let realDir: string
		let names: string[]
		try {
			realDir = await fs.promises.realpath(dir)
			names = await fs.promises.readdir(realDir)
		} catch {
			this.entries = next
			this.notes = notes
			return this.snapshot()
		}
		for (const name of names.sort()) {
			const match = MERIT_ARCHIVE_FILE_RE.exec(name)
			if (!match) continue
			const region = String(Number(match[1]))
			const refuse = (reason: string) => notes.push(meritInvalidProvenanceNote(region, reason))
			try {
				const file = path.join(realDir, name)
				const st = await fs.promises.lstat(file)
				if (st.isSymbolicLink() || !st.isFile()) {
					refuse("the archive is not a regular file")
					continue
				}
				if (!(await insideDir(realDir, file))) {
					refuse("the archive resolves outside the tiles directory")
					continue
				}
				const sidecarPath = file + MERIT_SIDECAR_SUFFIX
				const sidecarStat = await fs.promises.lstat(sidecarPath).catch(() => undefined)
				if (!sidecarStat) {
					refuse("no sidecar")
					continue
				}
				if (sidecarStat.isSymbolicLink() || !sidecarStat.isFile() || sidecarStat.size > SIDECAR_MAX_BYTES) {
					refuse("the sidecar is not a regular file of reasonable size")
					continue
				}
				if (!(await insideDir(realDir, sidecarPath))) {
					refuse("the sidecar resolves outside the tiles directory")
					continue
				}
				let raw: unknown
				try {
					raw = JSON.parse(await fs.promises.readFile(sidecarPath, "utf8"))
				} catch {
					refuse("the sidecar is not valid JSON")
					continue
				}
				const checked = checkSidecar(raw, { name, sizeBytes: st.size })
				if (!checked.ok) {
					refuse(checked.reason)
					continue
				}
				if (Number(checked.provenance.region) !== Number(match[1])) {
					refuse("the sidecar names another region")
					continue
				}
				const header = await readHeader(file)
				if (typeof header === "string") {
					refuse(header)
					continue
				}
				const key = `${file}|${st.size}|${st.mtimeMs}`
				const state = this.hashes.get(key)
				if (state === "mismatch") {
					notes.push(
						`Local MERIT tiles for region ${region} were withdrawn: the file's sha256 does not match its provenance record. Rebuild them.`,
					)
					continue
				}
				if (!state) this.startHash(key, file, checked.provenance.tilesSha256)
				const id = name.replace(/\.pmtiles$/, "")
				next.set(id, {
					id,
					file,
					size: st.size,
					mtimeMs: st.mtimeMs,
					offer: {
						id,
						region,
						minZoom: header.minZoom,
						maxZoom: header.maxZoom,
						bounds: header.bounds,
						layers: [...MERIT_LAYER_NAMES],
						provenance: { ...checked.provenance, verification: state === "ok" ? "sha256-verified" : "size-matched" },
					},
				})
			} catch (err) {
				refuse(err instanceof Error ? err.message : String(err))
			}
		}
		this.entries = next
		this.notes = notes
		return this.snapshot()
	}

	private startHash(key: string, file: string, expected: string): void {
		this.hashes.set(key, "pending")
		const hashFile = this.options.hashFile ?? sha256OfFile
		const job: Promise<void> = hashFile(file)
			.then((digest) => {
				this.hashes.set(key, digest === expected ? "ok" : "mismatch")
			})
			.catch(() => {
				// Unreadable: it stays "size-matched" and is not hashed again until the file changes.
				this.hashes.set(key, "error")
			})
			.then(async () => {
				const state = this.hashes.get(key)
				if (state === "pending" || state === "error") return
				await this.scan()
				this.options.onChange?.()
			})
			.finally(() => this.pendingHashes.delete(job))
		this.pendingHashes.add(job)
	}

	/** Resolves when no background hash is running (tests). */
	async whenVerified(): Promise<void> {
		while (this.pendingHashes.size > 0) await Promise.all([...this.pendingHashes])
	}

	/**
	 * Bytes `[offset, offset + length)` of an offered archive, as a fresh `ArrayBuffer` of exactly the bytes read (short
	 * only at the end of the file). It is an `ArrayBuffer`, not a Node `Buffer`: the webview message channel sends an
	 * ArrayBuffer as binary but serialises a Buffer one number per byte. The `Uint8Array` is allocated for this read,
	 * so its `.buffer` is not a pooled slab.
	 */
	async readRange(archiveId: unknown, offset: unknown, length: unknown): Promise<{ data: ArrayBuffer; etag: string }> {
		if (typeof archiveId !== "string" || !MERIT_ARCHIVE_ID_RE.test(archiveId)) throw new Error("unknown archive")
		const entry = this.entries.get(archiveId)
		if (!entry) throw new Error("unknown archive")
		const problem = checkRangeRequest(offset, length, entry.size)
		if (problem) throw new Error(problem)
		const start = offset as number
		const count = Math.min(length as number, entry.size - start)
		const st = await fs.promises.lstat(entry.file)
		if (st.isSymbolicLink() || !st.isFile() || st.size !== entry.size || st.mtimeMs !== entry.mtimeMs)
			throw new Error("The MERIT tile archive changed on disk. Reopen the map to reload it.")
		// Opened for the one read and closed again (not kept open): a rebuild replaces the file, and an open handle
		// would block that on Windows.
		const handle = await fs.promises.open(entry.file, "r")
		try {
			const opened = await handle.stat()
			if (opened.size !== entry.size || opened.mtimeMs !== entry.mtimeMs)
				throw new Error("The MERIT tile archive changed on disk. Reopen the map to reload it.")
			const bytes = new Uint8Array(count)
			let done = 0
			while (done < count) {
				const { bytesRead } = await handle.read(bytes, done, count - done, start + done)
				if (bytesRead === 0) throw new Error("The MERIT tile archive ended early.")
				done += bytesRead
			}
			return { data: bytes.buffer as ArrayBuffer, etag: `${entry.size}-${entry.mtimeMs}` }
		} finally {
			await handle.close()
		}
	}
}

async function insideDir(realDir: string, file: string): Promise<boolean> {
	const real = await fs.promises.realpath(file)
	const rel = path.relative(realDir, real)
	return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel) && path.dirname(real) === realDir
}

async function readHeader(file: string): Promise<PmtilesHeader | string> {
	const handle = await fs.promises.open(file, "r")
	try {
		const bytes = new Uint8Array(PMTILES_HEADER_BYTES)
		const { bytesRead } = await handle.read(bytes, 0, PMTILES_HEADER_BYTES, 0)
		return parsePmtilesHeader(bytes.subarray(0, bytesRead))
	} finally {
		await handle.close()
	}
}
