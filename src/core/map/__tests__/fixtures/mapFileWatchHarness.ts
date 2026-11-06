import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as fsp from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { MapLayer, MapLayerStyle } from "@shared/proto/cline/map"
import { type Disposable, MapFileWatch, type MapFileWatchOptions, type ParseRequest, type WatchReport } from "../../mapFileWatch"
import { mergeMapLayerPatch } from "../../mergeMapLayerPatch"
import { refreshLayerFromFile } from "../../refreshFromFile"

/**
 * A map and a panel made of plain objects around the real `MapFileWatch` and the real file system (a scratch folder).
 * The panel answers a parse request the way the page does: fetch the file, compare its size with the host's, parse.
 */
export const FAST: Partial<MapFileWatchOptions> = {
	debounceMs: 25,
	missingGraceMs: 120,
	parseRetryMs: 150,
	unstableRetryMs: 25,
	requestTimeoutMs: 3000,
}

export const sha = (bytes: Uint8Array | string): string => crypto.createHash("sha256").update(bytes).digest("hex")

export const fc = (n: number, extra = ""): string =>
	JSON.stringify({
		type: "FeatureCollection",
		features: [{ type: "Feature", properties: { n }, geometry: { type: "Point", coordinates: [n, n] } }],
		...(extra ? { note: extra } : {}),
	})

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function until(cond: () => boolean, timeoutMs = 2000, stepMs = 5): Promise<boolean> {
	const end = Date.now() + timeoutMs
	while (Date.now() < end) {
		if (cond()) return true
		await wait(stepMs)
	}
	return cond()
}

export interface Harness {
	dir: string
	watch: MapFileWatch
	layers: Map<string, MapLayer>
	order: string[]
	reports: WatchReport[]
	requests: ParseRequest[]
	patches: Array<{ layerId: string; metadata: Record<string, string> }>
	focusEvents: number
	panel: { open: boolean; answer: "page" | "fail_parse" | "never" }
	/** Folders a watcher was asked for. */
	watchedFolders: string[]
	/** Fire a watcher event for a file, as the folder watcher or the workspace watcher would. */
	emit(file: string): void
	/** The paths the map is not allowed to load. */
	denied: Set<string>
	/** A page that reads this many bytes less than the host saw (a file that changed between the two reads). */
	fetchHook?: (request: ParseRequest) => Promise<void>
	cleanup(): Promise<void>
}

export interface HarnessOptions {
	options?: Partial<MapFileWatchOptions>
	/** Folders counted as open workspace folders. Default: the scratch dir. */
	workspace?: boolean
	fs?: ConstructorParameters<typeof MapFileWatch>[0]["fs"]
	panelOpen?: boolean
}

export function layerFor(
	file: string,
	content: string,
	meta: Record<string, string> = {},
	over: Partial<MapLayer> = {},
): MapLayer {
	const st = fs.statSync(file)
	return MapLayer.create({
		id: `user-${path.basename(file)}`,
		name: path.basename(file),
		geojson: content,
		layerType: "polygon",
		visible: true,
		style: MapLayerStyle.create({ fillColor: "#ff0000", strokeColor: "#00ff00", strokeWidth: 3 }),
		metadata: {
			source: "user",
			source_path: file,
			source_size_bytes: String(st.size),
			source_mtime_ms: String(Math.round(st.mtimeMs)),
			source_status: "current",
			...meta,
		},
		...over,
	})
}

export async function makeHarness(opts: HarnessOptions = {}): Promise<Harness> {
	const dir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "aih-mfw-")))
	const layers = new Map<string, MapLayer>()
	const order: string[] = []
	const listeners = new Set<(file: string) => void>()
	const folderListeners = new Map<string, (file: string) => void>()
	const h: Harness = {
		dir,
		layers,
		order,
		reports: [],
		requests: [],
		patches: [],
		focusEvents: 0,
		panel: { open: opts.panelOpen ?? true, answer: "page" },
		watchedFolders: [],
		denied: new Set(),
		watch: undefined as unknown as MapFileWatch,
		emit: (file) => {
			for (const l of listeners) l(file)
			for (const l of folderListeners.values()) l(file)
		},
		cleanup: async () => {
			h.watch.dispose()
			await fsp.rm(dir, { recursive: true, force: true })
		},
	}
	const answer = async (request: ParseRequest) => {
		if (h.panel.answer === "never") return
		await h.fetchHook?.(request)
		let bytes: Buffer
		try {
			bytes = await fsp.readFile(request.path)
		} catch {
			h.watch.onParseResult({ requestId: request.requestId, ok: false, reason: "changed_while_reading" })
			return
		}
		if (bytes.length !== request.sizeBytes) {
			h.watch.onParseResult({ requestId: request.requestId, ok: false, reason: "changed_while_reading" })
			return
		}
		if (h.panel.answer === "fail_parse") {
			h.watch.onParseResult({
				requestId: request.requestId,
				ok: false,
				reason: "parse",
				message: "Unexpected end of JSON input",
			})
			return
		}
		try {
			JSON.parse(bytes.toString("utf8"))
		} catch (err) {
			h.watch.onParseResult({ requestId: request.requestId, ok: false, reason: "parse", message: (err as Error).message })
			return
		}
		h.watch.onParseResult({
			requestId: request.requestId,
			ok: true,
			geojson: bytes.toString("utf8"),
			metadata: {
				source_format: "geojson",
				feature_count: "1",
				source_path: "/etc/passwd",
				_run_id: "forged",
				tool: "forged",
			},
		})
	}
	h.watch = new MapFileWatch(
		{
			layers: () => [...layers.values()],
			fs: opts.fs ?? { stat: (p) => fsp.stat(p), readFile: (p) => fsp.readFile(p) },
			authorize: async (p) => (h.denied.has(p) ? undefined : p),
			workspaceFolders: () => (opts.workspace === false ? [] : [dir]),
			watchFolder: (folder, onEvent) => {
				h.watchedFolders.push(folder)
				folderListeners.set(folder, onEvent)
				return { dispose: () => void folderListeners.delete(folder) } satisfies Disposable
			},
			onWorkspaceEvent: (listener) => {
				listeners.add(listener)
				return { dispose: () => void listeners.delete(listener) }
			},
			panelOpen: () => h.panel.open,
			requestParse: (request) => {
				if (!h.panel.open) return false
				h.requests.push(request)
				void answer(request)
				return true
			},
			patchLayer: (layerId, metadata) => {
				h.patches.push({ layerId, metadata })
				const existing = layers.get(layerId)
				if (existing) layers.set(layerId, mergeMapLayerPatch(existing, { metadata }))
			},
			applyRefresh: (layerId, update, mode) => {
				const existing = layers.get(layerId)
				if (!existing) return { ok: false, reason: "gone" }
				const outcome = refreshLayerFromFile(existing, update, mode)
				if (outcome.ok) layers.set(layerId, outcome.layer)
				return outcome
			},
			report: (r) => h.reports.push(r),
		},
		{ ...FAST, ...opts.options },
	)
	h.watch.start()
	return h
}

export function addLayer(h: Harness, layer: MapLayer): void {
	h.layers.set(layer.id, layer)
	if (!h.order.includes(layer.id)) h.order.push(layer.id)
}
