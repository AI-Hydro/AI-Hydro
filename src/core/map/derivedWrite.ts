import { createHash } from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import { isPathInside } from "../workspace/workspaceGeoPaths"

/**
 * Where a converted layer (KMZ, KML, GPX, ... to GeoJSON) is written, and when it is not.
 *
 *   `<the source's own open folder>/.aihydro/map-derived/<stem>-<8 hex of sha1(source path)>.geojson`
 *   `<same>.provenance.json`
 *
 * The folder is the one the source file lives in, not the first folder of the window, so a multi-root project keeps
 * each folder's derived files with that folder. The short hash of the source path is in the name, so two sources that
 * share a name (`a/basin.kmz`, `b/basin.kmz`) never write the same file and one source's provenance is never replaced by
 * another's. When the content is already on disk (same sha256) nothing is written, so reopening a file does not change
 * a file or its timestamp. A provenance file that names a different source is never overwritten.
 */

const sha256 = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex")
const shortPathHash = (p: string): string => createHash("sha1").update(p).digest("hex").slice(0, 8)

const safeStem = (name: string): string =>
	(
		name
			.replace(/[?#].*$/, "")
			.split(/[\\/]/)
			.pop()
			?.replace(/\.(geojson|json)$/i, "")
			.replace(/[^a-zA-Z0-9._-]+/g, "_")
			.replace(/^_+|_+$/g, "") || "layer"
	).slice(0, 80)

export interface DerivedWriteInput {
	/** Open folders, in the order VS Code lists them. */
	folders: string[]
	/** Used when no open folder holds the source (no folder open, or a file outside every folder). */
	fallbackDir: string
	/** The source file's absolute path, when the layer has one. */
	sourcePath?: string
	name: string
	geojson: string
	/** Extra provenance fields (format, warnings, the source record the webview sent). */
	provenance: Record<string, unknown>
}

export interface DerivedWriteResult {
	artifactPath: string
	provenancePath: string
	/** The content was already on disk: nothing was written. */
	unchanged: boolean
}

/** The open folder that holds `sourcePath` (symlinks resolved), else the first one. */
export async function folderOfSource(folders: string[], sourcePath: string | undefined): Promise<string | undefined> {
	if (sourcePath && path.isAbsolute(sourcePath)) {
		let real = path.resolve(sourcePath)
		try {
			real = await fs.realpath(real)
		} catch {
			/* a file that is gone keeps its own path */
		}
		for (const folder of folders) {
			let realFolder = path.resolve(folder)
			try {
				realFolder = await fs.realpath(realFolder)
			} catch {
				/* keep */
			}
			if (isPathInside(realFolder, real)) return folder
		}
	}
	return folders[0]
}

export async function writeDerivedGeojson(input: DerivedWriteInput): Promise<DerivedWriteResult> {
	if (!input.geojson) throw new Error("No GeoJSON payload")
	const folder = await folderOfSource(input.folders, input.sourcePath)
	const dir = folder ? path.join(folder, ".aihydro", "map-derived") : path.join(input.fallbackDir, "map-derived")
	const identity = input.sourcePath ?? input.name
	const base = `${safeStem(input.name)}-${shortPathHash(identity)}`
	const artifactPath = path.join(dir, `${base}.geojson`)
	const provenancePath = path.join(dir, `${base}.provenance.json`)
	const bytes = Buffer.from(input.geojson, "utf8")
	const digest = sha256(bytes)

	let existing: { source?: { path?: string } | null; sha256?: string } | undefined
	try {
		existing = JSON.parse(await fs.readFile(provenancePath, "utf8"))
	} catch {
		/* no provenance yet */
	}
	const existingSource = existing?.source?.path
	const thisSource = (input.provenance.source as { path?: string } | null | undefined)?.path ?? input.sourcePath
	if (existing && existingSource && thisSource && existingSource !== thisSource) {
		throw new Error(`${path.basename(provenancePath)} belongs to a different source file and was not overwritten.`)
	}
	if (existing?.sha256 === digest) {
		try {
			if (sha256(await fs.readFile(artifactPath)) === digest) return { artifactPath, provenancePath, unchanged: true }
		} catch {
			/* the artifact is gone: write it again */
		}
	}

	await fs.mkdir(dir, { recursive: true })
	await fs.writeFile(artifactPath, bytes)
	let featureCount: number | undefined
	try {
		const parsed = JSON.parse(input.geojson)
		featureCount = parsed?.type === "FeatureCollection" && Array.isArray(parsed.features) ? parsed.features.length : undefined
	} catch {
		/* not a collection */
	}
	const provenance = {
		schemaVersion: "1.0",
		artifactType: "ai-hydro.map-derived-vector",
		generatedAtUtc: new Date().toISOString(),
		...input.provenance,
		featureCount,
		artifactPath,
		sha256: digest,
	}
	await fs.writeFile(provenancePath, Buffer.from(JSON.stringify(provenance, null, 2), "utf8"))
	return { artifactPath, provenancePath, unchanged: false }
}
