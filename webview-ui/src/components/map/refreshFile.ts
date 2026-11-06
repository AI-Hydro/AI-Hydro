/**
 * The map page's half of a file refresh. The host read the file once and hashed it; here the same bytes are fetched, checked
 * against the size the host saw, and parsed with the loader that loaded the file in the first place. Nothing is drawn or
 * changed here: the answer goes back to the host, which decides whether the layer may take it (a layer with a run link
 * does not) and applies it in place.
 */

import { PLATFORM_CONFIG } from "../../config/platform.config"
import { loadFile } from "./formats"
import { LayerLoadError } from "./formats/types"

export interface RefreshFileRequest {
	requestId: string
	layerId: string
	/** A webview URI for the file. */
	uri: string
	/** The absolute path, for the loader's source record. */
	path: string
	name: string
	/** The size the host measured. A different number of bytes arrived: the file changed while it was read. */
	sizeBytes: number
	/** The sha256 the host computed from the bytes it read. The bytes parsed here must hash to the same value. */
	sha256: string
	mtimeMs: number
}

export interface RefreshFileResult {
	type: "aihydro-map-refresh-result"
	requestId: string
	layerId: string
	ok: boolean
	reason?: "changed_while_reading" | "unsupported" | "parse"
	message?: string
	geojson?: string
	metadata?: Record<string, string>
}

export interface RefreshIo {
	fetchBytes: (uri: string) => Promise<Uint8Array>
	/** Hex sha256 of the bytes, or undefined where the page has no crypto (the size check alone then applies). */
	sha256: (bytes: Uint8Array) => Promise<string | undefined>
	load: typeof loadFile
	post: (message: RefreshFileResult) => void
}

const defaultIo: RefreshIo = {
	fetchBytes: async (uri) => {
		const response = await fetch(uri)
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`)
		}
		return new Uint8Array(await response.arrayBuffer())
	},
	sha256: async (bytes) => {
		const subtle = globalThis.crypto?.subtle
		if (!subtle) return undefined
		const digest = new Uint8Array(await subtle.digest("SHA-256", bytes as BufferSource))
		return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("")
	},
	load: loadFile,
	post: (message) => PLATFORM_CONFIG.postMessage(message),
}

export function isRefreshFileRequest(msg: unknown): msg is RefreshFileRequest {
	const m = msg as Partial<RefreshFileRequest> | null
	return (
		!!m &&
		typeof m.requestId === "string" &&
		typeof m.layerId === "string" &&
		typeof m.uri === "string" &&
		typeof m.path === "string" &&
		typeof m.name === "string" &&
		typeof m.sizeBytes === "number" &&
		typeof m.sha256 === "string" &&
		typeof m.mtimeMs === "number"
	)
}

export async function answerRefreshRequest(request: RefreshFileRequest, io: RefreshIo = defaultIo): Promise<void> {
	const base = { type: "aihydro-map-refresh-result" as const, requestId: request.requestId, layerId: request.layerId }
	let bytes: Uint8Array
	try {
		bytes = await io.fetchBytes(request.uri)
	} catch {
		// The file was replaced or removed between the host's read and this one.
		io.post({ ...base, ok: false, reason: "changed_while_reading" })
		return
	}
	// The bytes parsed must be the bytes the host hashed: a rewrite of the same length is still a different file.
	const same = bytes.length === request.sizeBytes && ((await io.sha256(bytes)) ?? request.sha256) === request.sha256
	if (!same) {
		io.post({ ...base, ok: false, reason: "changed_while_reading" })
		return
	}
	try {
		const spec = await io.load(new File([bytes as BlobPart], request.name), {
			source: { path: request.path, displayPath: request.path, sizeBytes: request.sizeBytes, mtimeMs: request.mtimeMs },
		})
		if (spec.kind !== "vector") {
			io.post({ ...base, ok: false, reason: "unsupported" })
			return
		}
		io.post({ ...base, ok: true, geojson: spec.geojson, metadata: { ...(spec.metadata ?? {}) } })
	} catch (err) {
		io.post({
			...base,
			ok: false,
			reason: "parse",
			message: err instanceof LayerLoadError ? err.message : err instanceof Error ? err.message : String(err),
		})
	}
}
