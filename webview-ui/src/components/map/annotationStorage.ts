/**
 * annotationStorage.ts  (v2)
 * Persistent storage for map pins (type "point"), sketched lines/areas and named Collections.
 *
 * Pins are scoped to the project (X1-M2): the extension host owns the per-project buckets, and this module keeps a
 * localStorage copy under `aihydro.map.pins.v3:<projectKey>` as a fast cache. Until the host has said which project
 * this is, and when there is no host at all (a plain browser, tests), the old unscoped `aihydro.map.annotations.v2`
 * list is used, exactly as before. Once a project key is known the unscoped list is never written again.
 *
 * v2 changes vs v1:
 *  - `comment`  → split into `notes` (personal) and `aiPrompt` (agent instruction)
 *  - `tags`     → `string[]` (was comma-string)
 *  - Added: `status`, `priority`, `collectionIds`, `updatedAt`
 *  - Added: `AnnotationCollection` type + CRUD helpers
 */

import { extractPhotoPaths } from "./photoPaths"
import { nextDefaultName, sanitizeAnnotations } from "./pins"

// ─── Storage keys ────────────────────────────────────────────────────────────
const ANNOTATIONS_KEY = "aihydro.map.annotations.v2"
const ANNOTATIONS_V1_KEY = "aihydro.map.annotations.v1"
const PINS_CACHE_PREFIX = "aihydro.map.pins.v3:"
const COLLECTIONS_CACHE_PREFIX = "aihydro.map.collections.v2:"
const COLLECTIONS_KEY = "aihydro.map.annotation.collections.v1"

// ─── Types ────────────────────────────────────────────────────────────────────

export type AnnotationStatus = "open" | "in-progress" | "reviewed" | "done"
export type AnnotationPriority = "low" | "medium" | "high"

export interface MapAnnotation {
	id: string
	name: string

	/** Personal field notes — context for the researcher, included as background for the agent */
	notes: string

	/** Optional explicit agent instruction. If empty the agent gets a smart default. */
	aiPrompt: string

	/** CSS hex colour */
	color: string

	type: "point" | "polygon" | "line"

	/** GeoJSON geometry */
	geometry: {
		type: "Point" | "Polygon" | "LineString"
		coordinates: number[] | number[][] | number[][][]
	}

	/** Tags for filtering/search */
	tags: string[]

	/** Absolute local filesystem paths to attached site-visit photos */
	images: string[]

	/** IDs of AnnotationCollections this annotation belongs to */
	collectionIds: string[]

	status: AnnotationStatus
	priority: AnnotationPriority | null

	/** Carried over from the pre-project global list; the Pins panel offers "Keep / Clear all" for these once. */
	imported?: boolean

	createdAt: string
	updatedAt: string
}

export interface AnnotationCollection {
	id: string
	name: string
	description: string
	/** CSS hex colour chip */
	color: string
	createdAt: string
	updatedAt: string
}

// ─── Colours ─────────────────────────────────────────────────────────────────

export const PRESET_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#6366f1", "#ec4899", "#ffffff"]

export const STATUS_COLORS: Record<string, string> = {
	Working: "#22c55e",
	"Not Working": "#ef4444",
	"Site Visit (pending)": "#eab308",
	Unclassified: "#94a3b8",
}

export const COLLECTION_COLORS = ["#6366f1", "#06b6d4", "#22c55e", "#f97316", "#ec4899", "#eab308", "#ef4444", "#8b5cf6"]

// ─── Migration helpers ────────────────────────────────────────────────────────

interface V1Annotation {
	id: string
	name: string
	comment: string
	color: string
	type: "point" | "polygon" | "line"
	geometry: MapAnnotation["geometry"]
	tags: string
	createdAt: string
}

function migrateV1toV2(v1: V1Annotation): MapAnnotation {
	return {
		id: v1.id,
		name: v1.name,
		notes: v1.comment ?? "", // comment → notes
		aiPrompt: "",
		color: v1.color ?? PRESET_COLORS[0],
		type: v1.type,
		geometry: v1.geometry,
		tags: v1.tags
			? v1.tags
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean)
			: [],
		images: [],
		collectionIds: [],
		status: "open",
		priority: null,
		createdAt: v1.createdAt,
		updatedAt: v1.createdAt,
	}
}

// ─── Annotation CRUD ─────────────────────────────────────────────────────────

/** The project the map is showing, once the host has said. Null: unscoped (no host, or it has not answered yet). */
let activeProjectKey: string | null = null

export function setActiveProjectKey(key: string | null): void {
	activeProjectKey = key
}

export function getActiveProjectKey(): string | null {
	return activeProjectKey
}

function readList(key: string): unknown {
	const raw = localStorage.getItem(key)
	return raw ? JSON.parse(raw) : null
}

/** What `loadAnnotations` found, with how many entries were dropped or renamed on the way in. */
export interface LoadedAnnotations {
	annotations: MapAnnotation[]
	dropped: number
	/** The dropped entries, verbatim (see `postQuarantine`). */
	quarantined: unknown[]
	renamed: number
}

export function loadAnnotationsReport(projectKey: string | null = activeProjectKey): LoadedAnnotations {
	try {
		if (projectKey) {
			return sanitizeAnnotations(readList(PINS_CACHE_PREFIX + projectKey))
		}
		// Unscoped: v2 first, then v1 (migrated and saved as v2).
		const v2 = readList(ANNOTATIONS_KEY)
		if (v2) {
			return sanitizeAnnotations(v2)
		}
		const v1 = readList(ANNOTATIONS_V1_KEY) as V1Annotation[] | null
		if (Array.isArray(v1)) {
			const migrated = sanitizeAnnotations(v1.map(migrateV1toV2))
			saveAnnotations(migrated.annotations)
			return migrated
		}
		return { annotations: [], dropped: 0, quarantined: [], renamed: 0 }
	} catch {
		return { annotations: [], dropped: 0, quarantined: [], renamed: 0 }
	}
}

export function loadAnnotations(projectKey: string | null = activeProjectKey): MapAnnotation[] {
	return loadAnnotationsReport(projectKey).annotations
}

/** The unscoped list as stored, for the host to adopt when it never held a copy. Null when there is none. */
export function readLegacyLocal(): unknown {
	try {
		return readList(ANNOTATIONS_KEY)
	} catch {
		return null
	}
}

/**
 * The host has said which project this is. From now on the cache is that project's. The old unscoped list is removed
 * locally (so the next map does not flash another project's pins before the host answers) ONLY when the host's list
 * holds every one of its ids: if the host did not take them (another project already claimed the list, or the host has
 * an older copy), the local copy is the only one and stays.
 */
export function adoptHostPins(projectKey: string, annotations: MapAnnotation[], collections: AnnotationCollection[] = []): void {
	activeProjectKey = projectKey
	try {
		localStorage.setItem(PINS_CACHE_PREFIX + projectKey, JSON.stringify(annotations))
		localStorage.setItem(COLLECTIONS_CACHE_PREFIX + projectKey, JSON.stringify(collections))
		const legacy = readList(ANNOTATIONS_KEY)
		if (Array.isArray(legacy)) {
			const have = new Set(annotations.map((a) => a.id))
			const covered = legacy.every((e) => e && typeof e === "object" && have.has((e as { id?: string }).id as string))
			if (covered) {
				localStorage.removeItem(ANNOTATIONS_KEY)
			}
		}
	} catch {
		/* ignore */
	}
}

export function saveAnnotations(annotations: MapAnnotation[], collections?: AnnotationCollection[]): void {
	try {
		localStorage.setItem(
			activeProjectKey ? PINS_CACHE_PREFIX + activeProjectKey : ANNOTATIONS_KEY,
			JSON.stringify(annotations),
		)
	} catch {
		/* ignore */
	}
	// Async fire-and-forget to host (collections passed for atomic save; resolved from localStorage if omitted)
	const cols = collections ?? loadCollections()
	void saveAnnotationsToHost(annotations, cols)
}

/** Produce a new blank annotation at a given geometry */
export function newAnnotation(
	type: MapAnnotation["type"],
	geometry: MapAnnotation["geometry"],
	existing: MapAnnotation[],
): MapAnnotation {
	const now = new Date().toISOString()
	return {
		id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
		name: nextDefaultName(existing, type),
		notes: "",
		aiPrompt: "",
		color: PRESET_COLORS[existing.length % PRESET_COLORS.length],
		type,
		geometry,
		tags: [],
		images: [],
		collectionIds: [],
		status: "open",
		priority: null,
		createdAt: now,
		updatedAt: now,
	}
}

/**
 * Build tracker annotations from a GeoJSON layer's point features.
 * One open annotation per point: name + category tag + any photo paths from
 * `properties.photos`. Skips features whose name already has an annotation.
 */
export function seedAnnotationsFromGeoJson(
	geojson: string,
	existing: MapAnnotation[],
): { created: MapAnnotation[]; skipped: number } {
	let parsed: unknown
	try {
		parsed = JSON.parse(geojson)
	} catch {
		return { created: [], skipped: 0 }
	}
	const fc = parsed as {
		features?: Array<{ geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> }>
	}
	const features = Array.isArray(fc?.features) ? fc.features : []
	const taken = new Set(existing.map((a) => a.name.toLowerCase()))
	const created: MapAnnotation[] = []
	let skipped = 0
	let i = existing.length
	for (const f of features) {
		if (f?.geometry?.type !== "Point" || !Array.isArray(f.geometry.coordinates)) {
			continue
		}
		const [lon, lat] = f.geometry.coordinates as number[]
		if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
			continue
		}
		const props = f.properties ?? {}
		const name = String(props.name ?? props.Name ?? `Site ${i + 1}`)
		if (taken.has(name.toLowerCase())) {
			skipped++
			continue
		}
		taken.add(name.toLowerCase())
		const status = props.status ?? props.Status
		const sediment = props.sediment_category ?? props.category ?? props.Category
		const tags = [status, sediment].filter(Boolean).map(String)
		const now = new Date().toISOString()
		created.push({
			id: `ann_seed_${Date.now()}_${i}`,
			name,
			notes: typeof props.address === "string" ? `Address: ${props.address}` : "",
			aiPrompt: "",
			color: STATUS_COLORS[String(status)] ?? PRESET_COLORS[i % PRESET_COLORS.length],
			type: "point",
			geometry: { type: "Point", coordinates: [lon, lat] },
			tags,
			images: extractPhotoPaths(props.photos),
			collectionIds: [],
			status: "open",
			priority: null,
			createdAt: now,
			updatedAt: now,
		})
		i++
	}
	return { created, skipped }
}

// ─── Collection CRUD ──────────────────────────────────────────────────────────

export function loadCollections(): AnnotationCollection[] {
	try {
		// Collections belong to the project, like the pins they group.
		const raw = localStorage.getItem(activeProjectKey ? COLLECTIONS_CACHE_PREFIX + activeProjectKey : COLLECTIONS_KEY)
		return raw ? (JSON.parse(raw) as AnnotationCollection[]) : []
	} catch {
		return []
	}
}

export function saveCollections(collections: AnnotationCollection[]): void {
	try {
		localStorage.setItem(
			activeProjectKey ? COLLECTIONS_CACHE_PREFIX + activeProjectKey : COLLECTIONS_KEY,
			JSON.stringify(collections),
		)
	} catch {
		/* ignore */
	}
	void saveAnnotationsToHost(loadAnnotations(), collections)
}

export function newCollection(existingCount: number): AnnotationCollection {
	const now = new Date().toISOString()
	return {
		id: `col_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
		name: `Collection ${existingCount + 1}`,
		description: "",
		color: COLLECTION_COLORS[existingCount % COLLECTION_COLORS.length],
		createdAt: now,
		updatedAt: now,
	}
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

/** Get the representative [lon, lat] centre of an annotation */
export function annotationCenter(ann: MapAnnotation): [number, number] {
	if (ann.type === "point") {
		const c = ann.geometry.coordinates as number[]
		return [c[0], c[1]]
	}
	if (ann.type === "line") {
		const coords = ann.geometry.coordinates as number[][]
		const mid = Math.floor(coords.length / 2)
		return [coords[mid][0], coords[mid][1]]
	}
	// polygon centroid
	const ring = (ann.geometry.coordinates as number[][][])[0] ?? []
	if (ring.length === 0) {
		return [0, 0]
	}
	const lon = ring.reduce((s, c) => s + c[0], 0) / ring.length
	const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length
	return [lon, lat]
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function csvEscape(v: unknown): string {
	const s = String(v ?? "")
	return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s
}

/** RFC 4180-compliant CSV row parser — symmetric with csvEscape. */
function parseCsvRow(line: string): string[] {
	const fields: string[] = []
	let i = 0
	while (i <= line.length) {
		if (line[i] === '"') {
			// Quoted field
			i++ // skip opening quote
			let field = ""
			while (i < line.length) {
				if (line[i] === '"' && line[i + 1] === '"') {
					field += '"'
					i += 2
				} else if (line[i] === '"') {
					i++ // skip closing quote
					break
				} else {
					field += line[i++]
				}
			}
			fields.push(field)
			if (line[i] === ",") i++
		} else {
			const start = i
			while (i < line.length && line[i] !== ",") i++
			fields.push(line.slice(start, i).trim())
			if (line[i] === ",") i++
		}
	}
	return fields
}

export function formatAnnotationsAsCsv(annotations: MapAnnotation[]): string {
	const headers = [
		"name",
		"type",
		"lon",
		"lat",
		"notes",
		"ai_prompt",
		"tags",
		"status",
		"priority",
		"color",
		"collection_ids",
		"created_at",
		"updated_at",
	]
	const rows = annotations.map((ann) => {
		const [lon, lat] = annotationCenter(ann)
		return [
			ann.name,
			ann.type,
			lon.toFixed(6),
			lat.toFixed(6),
			ann.notes,
			ann.aiPrompt,
			ann.tags.join(";"),
			ann.status,
			ann.priority ?? "",
			ann.color,
			ann.collectionIds.join(";"),
			ann.createdAt,
			ann.updatedAt,
		]
			.map(csvEscape)
			.join(",")
	})
	return [headers.join(","), ...rows].join("\n")
}

export function exportAnnotationsCsv(annotations: MapAnnotation[], filename = "aihydro_annotations.csv"): void {
	const csv = formatAnnotationsAsCsv(annotations)
	triggerDownload(new Blob([csv], { type: "text/csv" }), filename)
}

/** Parse a CSV file into MapAnnotation stubs. Required cols: name, lat, lon. */
export async function importAnnotationsCsv(file: File, existingCount = 0): Promise<Partial<MapAnnotation>[]> {
	return new Promise((resolve) => {
		const reader = new FileReader()
		reader.onload = (e) => {
			try {
				const text = e.target?.result as string
				const lines = text.split(/\r?\n/).filter(Boolean)
				if (lines.length < 2) {
					return resolve([])
				}
				const headers = parseCsvRow(lines[0]).map((h) => h.toLowerCase())
				const idxOf = (name: string) => headers.indexOf(name)
				const iLon = idxOf("lon") >= 0 ? idxOf("lon") : idxOf("longitude")
				const iLat = idxOf("lat") >= 0 ? idxOf("lat") : idxOf("latitude")
				const iName = idxOf("name")
				const iNotes = idxOf("notes") >= 0 ? idxOf("notes") : idxOf("comment")
				const iAiPrompt = idxOf("ai_prompt")
				const iTags = idxOf("tags")
				const iStatus = idxOf("status")
				const iPriority = idxOf("priority")
				if (iLon < 0 || iLat < 0 || iName < 0) {
					return resolve([])
				}
				const results: Partial<MapAnnotation>[] = []
				const now = new Date().toISOString()
				for (let i = 1; i < lines.length; i++) {
					const cols = parseCsvRow(lines[i])
					const lon = parseFloat(cols[iLon] ?? "")
					const lat = parseFloat(cols[iLat] ?? "")
					const name = cols[iName] ?? `Site ${i}`
					if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
						continue
					}
					const rawTags = iTags >= 0 ? (cols[iTags] ?? "") : ""
					const status = (iStatus >= 0 ? cols[iStatus] : "open") as AnnotationStatus
					const priority = (iPriority >= 0 ? cols[iPriority] || null : null) as AnnotationPriority | null
					results.push({
						id: `ann_import_${Date.now()}_${i}`,
						name,
						notes: iNotes >= 0 ? (cols[iNotes] ?? "") : "",
						aiPrompt: iAiPrompt >= 0 ? (cols[iAiPrompt] ?? "") : "",
						tags: rawTags
							? rawTags
									.split(";")
									.map((t) => t.trim())
									.filter(Boolean)
							: [],
						color: PRESET_COLORS[(existingCount + i) % PRESET_COLORS.length],
						type: "point",
						geometry: { type: "Point", coordinates: [lon, lat] },
						images: [],
						collectionIds: [],
						status: ["open", "in-progress", "reviewed", "done"].includes(status) ? status : "open",
						priority: ["low", "medium", "high"].includes(priority as string) ? priority : null,
						createdAt: now,
						updatedAt: now,
					})
				}
				resolve(results)
			} catch {
				resolve([])
			}
		}
		reader.readAsText(file)
	})
}

// ─── Host persistence bridge (durable backup via VS Code globalState) ────────
//
// localStorage is the fast working copy; the extension host is the authoritative
// backup.  On save we fire-and-forget to the host. On mount, the map component
// calls syncAnnotationsFromHost() to restore after a cache eviction.

const HOST_SAVE_TYPE = "aihydro-map-save-annotations"
const HOST_LOAD_TYPE = "aihydro-map-load-annotations"
const HOST_LOAD_RESULT_TYPE = "aihydro-map-load-annotations-result"

/** Fire-and-forget: persist annotations + collections to the extension host. */
export async function saveAnnotationsToHost(annotations: MapAnnotation[], collections: AnnotationCollection[]): Promise<void> {
	// Until the host has said which project this is there is nothing to save to: the host writes only to the key the
	// webview loaded, so an unscoped save would be refused. The list is merged and saved when the host answers.
	const projectKey = activeProjectKey
	if (!projectKey) {
		return
	}
	try {
		const { PLATFORM_CONFIG } = await import("../../config/platform.config")
		PLATFORM_CONFIG.postMessage({
			type: HOST_SAVE_TYPE,
			projectKey,
			annotations,
			collections,
		})
	} catch {
		/* no-op outside VS Code */
	}
}

/** Hand entries that could not be read to the host to keep (it never deletes them), and say so in the console. */
export async function postQuarantine(projectKey: string | null, entries: unknown[]): Promise<void> {
	if (entries.length === 0) {
		return
	}
	console.warn(`[map] ${entries.length} stored pin(s) could not be read; they were set aside, not deleted`)
	try {
		const { PLATFORM_CONFIG } = await import("../../config/platform.config")
		PLATFORM_CONFIG.postMessage({ type: "aihydro-map-quarantine-pins", projectKey, entries })
	} catch {
		/* no-op outside VS Code */
	}
}

export interface HostPins {
	/** The project the host scoped these to. */
	projectKey: string
	annotations: MapAnnotation[]
	collections: AnnotationCollection[]
	/** Entries of the pre-project list handed to this project by this very call (0 afterwards). */
	importedCount: number
	/** Entries dropped as malformed, and default names migrated. */
	dropped: number
	/** The dropped entries, verbatim. */
	quarantined: unknown[]
	renamed: number
}

/**
 * Ask the host for this project's pins. Returns null if there is no host, it failed or it timed out; the caller then
 * keeps the unscoped local list. The unscoped local list is sent along so the host can hand it to the first project
 * when it never held a copy itself.
 */
export async function loadAnnotationsFromHost(legacyLocal?: unknown): Promise<HostPins | null> {
	return new Promise(async (resolve) => {
		const requestId = `ann-load-${Date.now()}`
		const timeoutId = window.setTimeout(() => {
			window.removeEventListener("message", handler)
			resolve(null)
		}, 3_000)

		const handler = (event: MessageEvent) => {
			const data = event.data as {
				type?: string
				requestId?: string
				ok?: boolean
				projectKey?: unknown
				importedCount?: unknown
				annotations?: unknown
				collections?: unknown
			}
			if (data?.type === HOST_LOAD_RESULT_TYPE && data.requestId === requestId) {
				window.clearTimeout(timeoutId)
				window.removeEventListener("message", handler)
				if (data.ok && typeof data.projectKey === "string") {
					const clean = sanitizeAnnotations(data.annotations)
					resolve({
						projectKey: data.projectKey,
						annotations: clean.annotations,
						collections: Array.isArray(data.collections) ? (data.collections as AnnotationCollection[]) : [],
						importedCount: typeof data.importedCount === "number" ? data.importedCount : 0,
						dropped: clean.dropped,
						quarantined: clean.quarantined,
						renamed: clean.renamed,
					})
				} else {
					resolve(null)
				}
			}
		}
		window.addEventListener("message", handler)

		try {
			const { PLATFORM_CONFIG } = await import("../../config/platform.config")
			PLATFORM_CONFIG.postMessage({ type: HOST_LOAD_TYPE, requestId, legacyLocal })
		} catch {
			window.clearTimeout(timeoutId)
			window.removeEventListener("message", handler)
			resolve(null)
		}
	})
}

// ─── Download helper ─────────────────────────────────────────────────────────

export function triggerDownload(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob)
	const a = document.createElement("a")
	a.href = url
	a.download = filename
	a.click()
	URL.revokeObjectURL(url)
}
