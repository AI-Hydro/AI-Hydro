/**
 * Explicit, rate-limited place-name geocoding against the public OSM Nominatim service.
 *
 * Policy (https://operations.osmfoundation.org/policies/nominatim/): no autocomplete /
 * search-as-you-type, at most 1 request per second, and results must be cached. This module
 * is only ever called from an explicit user action (Enter or the Search button), never from
 * a keystroke handler.
 *
 * Known limitation: a webview `fetch` cannot set `User-Agent`, so the policy's application
 * identification requirement is only met by the request Origin. Routing this through the
 * extension host with a proper User-Agent (or a policy-compliant provider) is a follow-up.
 */

export const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
export const NOMINATIM_MIN_INTERVAL_MS = 1000
const CACHE_MAX_ENTRIES = 50

export interface GeocodeHit {
	label: string
	lat: number
	lon: number
	bbox?: [number, number, number, number]
}

export interface PlaceGeocoderOptions {
	fetchFn?: typeof fetch
	now?: () => number
	sleep?: (ms: number) => Promise<void>
	minIntervalMs?: number
}

export function normalizeQuery(q: string): string {
	return q.trim().replace(/\s+/g, " ").toLowerCase()
}

export function createPlaceGeocoder(options: PlaceGeocoderOptions = {}) {
	const fetchFn = options.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
	const now = options.now ?? (() => Date.now())
	const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => window.setTimeout(r, ms)))
	const minIntervalMs = options.minIntervalMs ?? NOMINATIM_MIN_INTERVAL_MS
	const cache = new Map<string, GeocodeHit[]>()
	const inflight = new Map<string, Promise<GeocodeHit[]>>()
	// Serialises network calls so that spacing holds even when searches overlap.
	let lastRequestAt = Number.NEGATIVE_INFINITY
	let queue: Promise<unknown> = Promise.resolve()

	async function fetchHits(q: string, signal?: AbortSignal): Promise<GeocodeHit[]> {
		const wait = lastRequestAt + minIntervalMs - now()
		if (wait > 0) {
			await sleep(wait)
		}
		if (signal?.aborted) {
			throw new DOMException("Aborted", "AbortError")
		}
		lastRequestAt = now()
		const resp = await fetchFn(`${NOMINATIM_URL}?q=${encodeURIComponent(q)}&format=json&limit=5&polygon_geojson=0`, {
			signal,
			headers: { "Accept-Language": "en" },
		})
		if (!resp.ok) {
			throw new Error(`Place search failed (HTTP ${resp.status})`)
		}
		const data = (await resp.json()) as Array<{ display_name: string; lat?: string; lon?: string; boundingbox?: string[] }>
		return (data ?? [])
			.filter((item) => item.lat && item.lon)
			.map((item) => ({
				label: item.display_name,
				lat: parseFloat(item.lat as string),
				lon: parseFloat(item.lon as string),
				bbox: item.boundingbox
					? ([
							parseFloat(item.boundingbox[2]),
							parseFloat(item.boundingbox[0]),
							parseFloat(item.boundingbox[3]),
							parseFloat(item.boundingbox[1]),
						] as [number, number, number, number])
					: undefined,
			}))
	}

	return {
		/** Resolve a place name. Served from cache when possible; otherwise at most one request per interval. */
		search(rawQuery: string, signal?: AbortSignal): Promise<GeocodeHit[]> {
			const key = normalizeQuery(rawQuery)
			if (key.length < 2) {
				return Promise.resolve([])
			}
			const cached = cache.get(key)
			if (cached) {
				return Promise.resolve(cached)
			}
			const pending = inflight.get(key)
			if (pending) {
				return pending
			}
			const run = queue.then(() => fetchHits(key, signal))
			queue = run.catch(() => undefined)
			const tracked = run
				.then((hits) => {
					if (cache.size >= CACHE_MAX_ENTRIES) {
						const oldest = cache.keys().next().value
						if (oldest !== undefined) {
							cache.delete(oldest)
						}
					}
					cache.set(key, hits)
					return hits
				})
				.finally(() => {
					inflight.delete(key)
				})
			inflight.set(key, tracked)
			return tracked
		},
		clearCache() {
			cache.clear()
		},
	}
}

export type PlaceGeocoder = ReturnType<typeof createPlaceGeocoder>

/** Shared instance so the cache and rate limit hold across SearchBar remounts. */
export const placeGeocoder: PlaceGeocoder = createPlaceGeocoder()
