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
	fetchBlob: (uri: string) => Promise<Blob>
	load: typeof loadFile
	post: (message: RefreshFileResult) => void
}

const defaultIo: RefreshIo = {
	fetchBlob: async (uri) => {
		const response = await fetch(uri)
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`)
		}
		return await response.blob()
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
		typeof m.mtimeMs === "number"
	)
}

export async function answerRefreshRequest(request: RefreshFileRequest, io: RefreshIo = defaultIo): Promise<void> {
	const base = { type: "aihydro-map-refresh-result" as const, requestId: request.requestId, layerId: request.layerId }
	let blob: Blob
	try {
		blob = await io.fetchBlob(request.uri)
	} catch {
		// The file was replaced or removed between the host's read and this one.
		io.post({ ...base, ok: false, reason: "changed_while_reading" })
		return
	}
	if (blob.size !== request.sizeBytes) {
		io.post({ ...base, ok: false, reason: "changed_while_reading" })
		return
	}
	try {
		const spec = await io.load(new File([blob], request.name), {
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
