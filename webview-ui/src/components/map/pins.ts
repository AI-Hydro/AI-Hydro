/**
 * Pins: the pure model behind the map's pin tool, pin card and Pins panel (UX program 2026-11, X1-M2).
 *
 * A pin is a saved point with an editable name and an optional note. It is stored as a `MapAnnotation` of
 * `type: "point"`, so the older storage format, the CSV/GeoJSON export and the host backup keep working; lines and
 * polygons stay annotations too, and live under Draw. Everything here is a pure function of the list so the rules
 * (what a double-click may create, what an undo restores, what a malformed entry becomes) can be unit tested without
 * a map.
 */

import type { MapAnnotation } from "./annotationStorage"

/** deck.gl layer id of the pins and shapes overlay. It is internal: no UI text may show it. */
export const ANNOTATIONS_LAYER_ID = "__annotations-overlay"

/** Pixels within which a right-click counts as "on" a pin. */
export const PIN_HIT_RADIUS_PX = 14

/** Fixed, accessible pin colours (never chosen by position in the list). */
export const PIN_COLOR = "#f97316"

export const isPin = (a: MapAnnotation): boolean => a.type === "point"
export const pinsOf = (list: MapAnnotation[]): MapAnnotation[] => list.filter(isPin)
export const shapesOf = (list: MapAnnotation[]): MapAnnotation[] => list.filter((a) => !isPin(a))

export function pinCoords(pin: MapAnnotation): [number, number] {
	const c = pin.geometry.coordinates as number[]
	return [c[0], c[1]]
}

/** `45.46120°N, 69.59310°W`. The one spelling used by the menu, the card, the list and Copy. */
export function formatPinCoords(lon: number, lat: number): string {
	return `${Math.abs(lat).toFixed(5)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(5)}°${lon >= 0 ? "E" : "W"}`
}

/** The text of the label a user sees for a pin: its name, or a stable fallback when they cleared it. */
export function pinLabel(pin: Pick<MapAnnotation, "name">): string {
	return pin.name.trim() || "Untitled pin"
}

// ── naming ──────────────────────────────────────────────────────────────────

const DEFAULT_NAME = { point: "Pin", line: "Line", polygon: "Area" } as const

/** `Pin 3`: one more than the highest `Pin N` in the list, so a deleted pin's number is not handed out twice in a row. */
export function nextDefaultName(list: MapAnnotation[], type: MapAnnotation["type"]): string {
	const base = DEFAULT_NAME[type]
	const re = new RegExp(`^${base} (\\d+)$`)
	let max = 0
	for (const a of list) {
		const m = re.exec(a.name)
		if (m) {
			max = Math.max(max, Number(m[1]))
		}
	}
	return `${base} ${max + 1}`
}

// ── creating ────────────────────────────────────────────────────────────────

export function createPin(list: MapAnnotation[], lon: number, lat: number, now = new Date()): MapAnnotation {
	const iso = now.toISOString()
	return {
		id: `pin_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`,
		name: nextDefaultName(list, "point"),
		notes: "",
		aiPrompt: "",
		color: PIN_COLOR,
		type: "point",
		geometry: { type: "Point", coordinates: [lon, lat] },
		tags: [],
		images: [],
		collectionIds: [],
		status: "open",
		priority: null,
		createdAt: iso,
		updatedAt: iso,
	}
}

// ── edits, each one undoable ────────────────────────────────────────────────

export type PinEdit =
	| { kind: "add"; id: string }
	| { kind: "remove"; removed: { pin: MapAnnotation; index: number }[] }
	| { kind: "patch"; id: string; before: Pick<MapAnnotation, "name" | "notes"> }

export interface Edited {
	next: MapAnnotation[]
	/** What to hand to `undoEdit`. Absent when nothing changed. */
	edit?: PinEdit
}

export function addPin(list: MapAnnotation[], pin: MapAnnotation): Edited {
	return { next: [...list, pin], edit: { kind: "add", id: pin.id } }
}

export function removePins(list: MapAnnotation[], ids: string[]): Edited {
	const drop = new Set(ids)
	const removed = list.flatMap((pin, index) => (drop.has(pin.id) ? [{ pin, index }] : []))
	if (removed.length === 0) {
		return { next: list }
	}
	return { next: list.filter((a) => !drop.has(a.id)), edit: { kind: "remove", removed } }
}

/** Rename and/or re-note a pin. A blank name is refused (the previous name stays). */
export function patchPin(
	list: MapAnnotation[],
	id: string,
	patch: Partial<Pick<MapAnnotation, "name" | "notes">>,
	now = new Date(),
): Edited {
	const target = list.find((a) => a.id === id)
	if (!target) {
		return { next: list }
	}
	const name = patch.name !== undefined ? patch.name.trim() : target.name
	const notes = patch.notes !== undefined ? patch.notes : target.notes
	if (!name || (name === target.name && notes === target.notes)) {
		return { next: list }
	}
	return {
		next: list.map((a) => (a.id === id ? { ...a, name, notes, updatedAt: now.toISOString() } : a)),
		edit: { kind: "patch", id, before: { name: target.name, notes: target.notes } },
	}
}

/** Reverse one edit. Removed pins go back to the index they had (clamped when the list has shrunk since). */
export function undoEdit(list: MapAnnotation[], edit: PinEdit): MapAnnotation[] {
	switch (edit.kind) {
		case "add":
			return list.filter((a) => a.id !== edit.id)
		case "patch":
			return list.map((a) => (a.id === edit.id ? { ...a, ...edit.before } : a))
		case "remove": {
			const next = list.filter((a) => !edit.removed.some((r) => r.pin.id === a.id))
			for (const { pin, index } of [...edit.removed].sort((x, y) => x.index - y.index)) {
				next.splice(Math.min(index, next.length), 0, pin)
			}
			return next
		}
	}
}

// ── what a right-click or click is on ───────────────────────────────────────

/** The pin nearest a screen point, within `radiusPx`. `project` maps [lon, lat] to [x, y] pixels. */
export function pinAtPoint(
	list: MapAnnotation[],
	project: (lon: number, lat: number) => [number, number],
	x: number,
	y: number,
	radiusPx = PIN_HIT_RADIUS_PX,
): MapAnnotation | undefined {
	let best: { pin: MapAnnotation; d: number } | undefined
	for (const pin of pinsOf(list)) {
		const [lon, lat] = pinCoords(pin)
		const [px, py] = project(lon, lat)
		const d = Math.hypot(px - x, py - y)
		if (d <= radiusPx && (!best || d < best.d)) {
			best = { pin, d }
		}
	}
	return best?.pin
}

// ── loading from storage ────────────────────────────────────────────────────

const LEGACY_DEFAULT_NAME = /^Annotation (\d+)$/

export interface Sanitized {
	annotations: MapAnnotation[]
	/** Entries that could not be used (not an object, no geometry, non-finite coordinates). */
	dropped: number
	/** The dropped entries, verbatim. Callers keep them (the host quarantines them) so the next save cannot lose them. */
	quarantined: unknown[]
	/** Default names renamed from "Annotation N" to "Pin N". */
	renamed: number
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n)

/** A coordinate pair as numbers, or null. Numeric strings ("-69.5") are accepted: a CSV import or hand edit may have produced them. */
function coercePair(c: unknown): [number, number] | null {
	if (!Array.isArray(c) || c.length < 2) {
		return null
	}
	const lon = typeof c[0] === "string" && c[0].trim() !== "" ? Number(c[0]) : c[0]
	const lat = typeof c[1] === "string" && c[1].trim() !== "" ? Number(c[1]) : c[1]
	return finite(lon) && finite(lat) ? [lon, lat] : null
}

/** The geometry with every coordinate a number, or null when it cannot be repaired. */
function coerceGeometry(g: unknown): MapAnnotation["geometry"] | null {
	if (!g || typeof g !== "object") {
		return null
	}
	const { type, coordinates } = g as { type?: unknown; coordinates?: unknown }
	if (type === "Point") {
		const p = coercePair(coordinates)
		return p ? { type: "Point", coordinates: p } : null
	}
	if (type === "LineString") {
		const pts = Array.isArray(coordinates) ? coordinates.map(coercePair) : []
		return pts.length >= 2 && pts.every(Boolean) ? { type: "LineString", coordinates: pts as [number, number][] } : null
	}
	if (type === "Polygon") {
		const rings = Array.isArray(coordinates) ? coordinates.map((r) => (Array.isArray(r) ? r.map(coercePair) : [])) : []
		return rings.length >= 1 && rings.every((r) => r.length >= 3 && r.every(Boolean))
			? { type: "Polygon", coordinates: rings as [number, number][][] }
			: null
	}
	return null
}

const TYPE_OF_GEOMETRY = { Point: "point", LineString: "line", Polygon: "polygon" } as const

/**
 * Bring whatever was stored to a list the renderer can trust. A malformed entry is dropped (counted, so the caller can
 * warn) instead of reaching deck.gl, where one bad coordinate would fail the whole layer. Older pins named
 * "Annotation N" become "Pin N". Missing fields get their defaults; ids are made unique.
 */
export function sanitizeAnnotations(raw: unknown): Sanitized {
	if (!Array.isArray(raw)) {
		return { annotations: [], dropped: 0, quarantined: [], renamed: 0 }
	}
	const seen = new Set<string>()
	const out: MapAnnotation[] = []
	const quarantined: unknown[] = []
	let renamed = 0
	for (const entry of raw) {
		const geometry = entry && typeof entry === "object" ? coerceGeometry((entry as MapAnnotation).geometry) : null
		if (!geometry) {
			quarantined.push(entry)
			continue
		}
		const a = { ...(entry as Partial<MapAnnotation>), geometry }
		const type = TYPE_OF_GEOMETRY[geometry.type]
		let id = typeof a.id === "string" && a.id ? a.id : `pin_${Date.now()}_${out.length}`
		while (seen.has(id)) {
			id = `${id}_${out.length}`
		}
		seen.add(id)
		let name = typeof a.name === "string" ? a.name : ""
		const legacy = type === "point" ? LEGACY_DEFAULT_NAME.exec(name) : null
		if (legacy) {
			name = `Pin ${legacy[1]}`
			renamed++
		}
		const now = new Date().toISOString()
		out.push({
			...(a as MapAnnotation),
			id,
			name,
			type,
			notes: typeof a.notes === "string" ? a.notes : "",
			aiPrompt: typeof a.aiPrompt === "string" ? a.aiPrompt : "",
			color: typeof a.color === "string" && /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : PIN_COLOR,
			tags: Array.isArray(a.tags) ? a.tags.filter((t): t is string => typeof t === "string") : [],
			images: Array.isArray(a.images) ? a.images.filter((t): t is string => typeof t === "string") : [],
			collectionIds: Array.isArray(a.collectionIds) ? a.collectionIds : [],
			status: a.status ?? "open",
			priority: a.priority ?? null,
			createdAt: typeof a.createdAt === "string" ? a.createdAt : now,
			updatedAt: typeof a.updatedAt === "string" ? a.updatedAt : now,
		})
	}
	return { annotations: out, dropped: quarantined.length, quarantined, renamed }
}

// ── adopting the host's list ────────────────────────────────────────────────

/**
 * The list to show once the host has answered. The host's list wins. Pins the host does not have are kept when they are
 * the user's own and not yet synced: added since the map opened (ids not in `startedWith`), or saved by an earlier
 * session that never got an answer (`pendingSync`). The rest of what the map started with is the old unscoped cache,
 * which the host hands to one project only, and is not carried. The `pendingSync` mark is dropped: they are the host's
 * from now on.
 */
export function mergeAdopted(host: MapAnnotation[], current: MapAnnotation[], startedWith: ReadonlySet<string>): MapAnnotation[] {
	const have = new Set(host.map((a) => a.id))
	const carried = current
		.filter((a) => !have.has(a.id) && (!startedWith.has(a.id) || a.pendingSync))
		.map(({ pendingSync: _drop, ...rest }) => rest as MapAnnotation)
	return [...host, ...carried]
}

/** Seconds-scale backoff for retrying the host load: 1, 2, 4, 8, then 15 s. */
export function loadRetryDelayMs(attempt: number): number {
	return Math.min(15_000, 1_000 * 2 ** attempt)
}

/**
 * Call `load` until it returns something, waiting `loadRetryDelayMs` between tries. `cancelled` stops it. Returns the
 * result, or null when cancelled.
 */
export async function loadWithRetry<T>(
	load: () => Promise<T | null>,
	options: { cancelled: () => boolean; sleep?: (ms: number) => Promise<void> },
): Promise<T | null> {
	const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
	for (let attempt = 0; !options.cancelled(); attempt++) {
		const result = await load()
		if (result !== null) {
			return result
		}
		await sleep(loadRetryDelayMs(attempt))
	}
	return null
}

// ── undo history ────────────────────────────────────────────────────────────

/** The undo stack. It belongs to one project's list: `clear` it when the list is replaced. */
export class PinHistory {
	private edits: PinEdit[] = []
	push(edit: PinEdit): void {
		this.edits = [...this.edits.slice(-49), edit]
	}
	pop(): PinEdit | undefined {
		return this.edits.pop()
	}
	clear(): void {
		this.edits = []
	}
	get size(): number {
		return this.edits.length
	}
}
