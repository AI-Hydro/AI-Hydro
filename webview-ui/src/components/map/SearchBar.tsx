import React, { useCallback, useEffect, useRef, useState } from "react"
import { collectHydroSearchProblems } from "./hydroSearchProblems"
import { sendHydroMapCommand } from "./mapHydrologyBridge"
import { loadMapWorkspace, type MapBookmark, saveMapWorkspace } from "./mapWorkspace"
import { placeGeocoder } from "./placeGeocoder"

export interface SearchResult {
	label: string
	lon: number
	lat: number
	source: "nominatim" | "gauge" | "dam" | "coordinate"
	bbox?: [number, number, number, number]
	meta?: Record<string, string>
}

interface SearchBarProps {
	mapStyle?: "dark" | "light"
	/** When true, search lives inside the ribbon panel (no floating overlay). */
	embedded?: boolean
	viewBbox?: { minLon: number; minLat: number; maxLon: number; maxLat: number }
	onResultSelect?: (result: SearchResult) => void
	/** Current view state — needed to save bookmarks. */
	currentView?: { longitude: number; latitude: number; zoom: number; pitch?: number; bearing?: number }
}

function parseCoordinateInput(raw: string): SearchResult | null {
	const trimmed = raw.trim()
	if (!trimmed) {
		return null
	}

	// Decimal degrees: "45.123, -73.456" or "45.123 -73.456"
	const ddMatch = trimmed.match(/^\s*([+-]?\d+\.?\d*)\s*[,\s]\s*([+-]?\d+\.?\d*)\s*$/)
	if (ddMatch) {
		const lat = parseFloat(ddMatch[1])
		const lon = parseFloat(ddMatch[2])
		if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
			return { label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, lat, lon, source: "coordinate" }
		}
	}

	// DMS: "45°29'N, 73°34'W"
	const dmsMatch = trimmed.match(/^(\d+)°(\d+)'\s*([NnSs])\s*[,\s]\s*(\d+)°(\d+)'\s*([EeWw])$/)
	if (dmsMatch) {
		const lat = (parseInt(dmsMatch[1], 10) + parseInt(dmsMatch[2], 10) / 60) * (dmsMatch[3].toUpperCase() === "S" ? -1 : 1)
		const lon = (parseInt(dmsMatch[4], 10) + parseInt(dmsMatch[5], 10) / 60) * (dmsMatch[6].toUpperCase() === "W" ? -1 : 1)
		if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
			return { label: trimmed, lat, lon, source: "coordinate" }
		}
	}

	// UTM: "zone 44N 269000 3042000" (simplified — zone easting northing)
	const utmMatch = trimmed.match(/^(\d{1,2})\s*([Nn])\s+(\d+)\s+(\d+)$/)
	if (utmMatch) {
		// Very basic UTM→LatLon approximation for zone N/S only (good enough to fly to)
		const zone = parseInt(utmMatch[1], 10)
		const isNorth = utmMatch[2].toUpperCase() === "N"
		const easting = parseFloat(utmMatch[3])
		const northing = parseFloat(utmMatch[4])
		const lon = (zone - 1) * 6 - 180 + 3 + (easting - 500000) / (111320 * Math.cos((northing / 6378137) * (180 / Math.PI)))
		const lat = (northing - (isNorth ? 0 : 10000000)) / 111132
		if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
			return { label: `UTM ${zone}N ${easting} ${northing}`, lat, lon, source: "coordinate" }
		}
	}
	return null
}

function hydroHitsToResults(
	hits: Array<{ label: string; lat: number; lon: number; source: string; meta?: Record<string, string> }>,
): SearchResult[] {
	return hits
		.filter((h) => h.source === "gauge" || h.source === "dam")
		.map((h) => ({
			label: h.label,
			lat: h.lat,
			lon: h.lon,
			source: h.source as "gauge" | "dam",
			meta: h.meta,
		}))
}

/** Codicons, so the result list matches the rail and the panels. */
const SOURCE_ICON: Record<SearchResult["source"], string> = {
	gauge: "pulse",
	dam: "symbol-structure",
	coordinate: "location",
	nominatim: "globe",
}

const chip = (primary?: boolean) => `map-chip${primary ? " map-chip--primary" : ""}`

// ─── Bookmarks Panel ──────────────────────────────────────────────────────────

const BookmarksPanel: React.FC<{
	currentView?: SearchBarProps["currentView"]
	onFlyTo: (bk: MapBookmark) => void
}> = ({ currentView, onFlyTo }) => {
	const [bookmarks, setBookmarks] = useState<MapBookmark[]>(() => loadMapWorkspace().bookmarks ?? [])
	const [newName, setNewName] = useState("")
	const [naming, setNaming] = useState(false)

	const saveBookmark = () => {
		if (!currentView || !newName.trim()) {
			return
		}
		const bk: MapBookmark = {
			id: `bk_${Date.now()}`,
			name: newName.trim(),
			longitude: currentView.longitude,
			latitude: currentView.latitude,
			zoom: currentView.zoom,
			pitch: currentView.pitch,
			bearing: currentView.bearing,
			createdAt: new Date().toISOString(),
		}
		const next = [...bookmarks, bk]
		setBookmarks(next)
		saveMapWorkspace({ bookmarks: next })
		setNewName("")
		setNaming(false)
	}

	const removeBookmark = (id: string) => {
		const next = bookmarks.filter((b) => b.id !== id)
		setBookmarks(next)
		saveMapWorkspace({ bookmarks: next })
	}

	return (
		<div className="map-section">
			<div className="map-section-head">
				<span className="map-section-label">
					<span aria-hidden="true" className="codicon codicon-bookmark" />
					Bookmarks
				</span>
				{currentView && !naming && (
					<button
						className={chip()}
						onClick={() => setNaming(true)}
						title="Save current view as bookmark"
						type="button">
						<span aria-hidden="true" className="codicon codicon-add" />
						Save view
					</button>
				)}
			</div>

			{naming && (
				<div className="map-row">
					<input
						aria-label="Bookmark name"
						autoFocus
						className="map-field"
						maxLength={40}
						onChange={(e) => setNewName(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								saveBookmark()
							}
							if (e.key === "Escape") {
								setNaming(false)
								setNewName("")
							}
						}}
						placeholder="Bookmark name"
						type="text"
						value={newName}
					/>
					<button aria-label="Save bookmark" className={chip(true)} onClick={saveBookmark} title="Save" type="button">
						<span aria-hidden="true" className="codicon codicon-check" />
					</button>
					<button
						aria-label="Cancel"
						className={chip()}
						onClick={() => {
							setNaming(false)
							setNewName("")
						}}
						title="Cancel"
						type="button">
						<span aria-hidden="true" className="codicon codicon-close" />
					</button>
				</div>
			)}

			{bookmarks.length === 0 ? (
				<div className="map-hint">No bookmarks yet. Move the map where you want it and choose Save view.</div>
			) : (
				<ul className="map-plainlist">
					{bookmarks.map((bk) => (
						<li className="map-listrow" key={bk.id}>
							<button
								className="map-listrow__main"
								onClick={() => onFlyTo(bk)}
								title={`${bk.latitude.toFixed(4)}, ${bk.longitude.toFixed(4)} · zoom ${bk.zoom.toFixed(1)}`}
								type="button">
								{bk.name}
							</button>
							<span className="map-hint">z{bk.zoom.toFixed(1)}</span>
							<button
								aria-label={`Remove bookmark ${bk.name}`}
								className="map-overflow-trigger"
								onClick={() => removeBookmark(bk.id)}
								title="Remove bookmark"
								type="button">
								<span aria-hidden="true" className="codicon codicon-trash" />
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}

// ─── SearchBar ────────────────────────────────────────────────────────────────

export const SearchBar: React.FC<SearchBarProps> = ({ embedded = false, viewBbox, onResultSelect, currentView }) => {
	const [query, setQuery] = useState("")
	const [results, setResults] = useState<SearchResult[]>([])
	const [loading, setLoading] = useState(false)
	const [selectedIdx, setSelectedIdx] = useState(-1)
	const [coordInput, setCoordInput] = useState("")
	const [coordError, setCoordError] = useState("")
	const [notice, setNotice] = useState<{ kind: "problem" | "empty" | "geocode"; text: string } | null>(null)
	const abortRef = useRef<AbortController | null>(null)
	const hydroSeqRef = useRef(0)
	const hydroResultsRef = useRef<SearchResult[]>([])
	const [searchedPlaces, setSearchedPlaces] = useState(false)
	// Place-name results for the query they were fetched for, so a later (or debounced) hydro response for the
	// same text merges with them instead of overwriting them.
	const placeResultsRef = useRef<{ query: string; results: SearchResult[] } | null>(null)

	/**
	 * Coordinate + USGS gauge / NID dam lookup (local Python CLI, not a public web service).
	 * Runs on a debounce while typing. Stale responses are discarded.
	 */
	const doHydroSearch = useCallback(
		async (q: string) => {
			const seq = ++hydroSeqRef.current
			if (!q.trim()) {
				hydroResultsRef.current = []
				setResults([])
				setNotice(null)
				setLoading(false)
				return
			}
			setLoading(true)
			const coord = parseCoordinateInput(q)
			let hydro: SearchResult[] = []
			let problems: string[] = []
			if (q.trim().length >= 2) {
				try {
					const r = await sendHydroMapCommand("searchHydrology", {
						q: q.trim(),
						...(viewBbox ?? {}),
						limit: 15,
					})
					problems = collectHydroSearchProblems(r)
					const hits =
						(r.result?.hits as Array<{
							label: string
							lat: number
							lon: number
							source: string
							meta?: Record<string, string>
						}>) ?? []
					hydro = hydroHitsToResults(hits)
				} catch (e) {
					problems = [e instanceof Error ? e.message : "hydrology search failed"]
				}
			}
			if (seq !== hydroSeqRef.current) {
				return
			}
			const base = [...(coord ? [coord] : []), ...hydro]
			hydroResultsRef.current = base
			const placeSearched = placeResultsRef.current?.query === q.trim()
			const places = placeSearched ? (placeResultsRef.current?.results ?? []) : []
			if (!placeSearched) {
				placeResultsRef.current = null
			}
			const all = [...base, ...places]
			setResults(all)
			setSearchedPlaces(places.length > 0)
			setSelectedIdx(-1)
			if (problems.length > 0) {
				setNotice({ kind: "problem", text: `USGS lookup incomplete: ${problems.join("; ")}` })
			} else if (placeSearched && places.length === 0 && all.length === 0) {
				setNotice({ kind: "empty", text: "No place found for that name." })
			} else if (all.length === 0 && q.trim().length >= 2) {
				setNotice({ kind: "empty", text: "No gauge, dam or coordinate match. Press Enter to search place names." })
			} else {
				setNotice(null)
			}
			setLoading(false)
		},
		[viewBbox],
	)

	/**
	 * Place-name geocoding (public Nominatim). Explicit only: Enter or the Search button.
	 * Cached and rate-limited in placeGeocoder; never called from the typing debounce.
	 */
	const doPlaceSearch = useCallback(async (q: string) => {
		if (q.trim().length < 2) {
			return
		}
		abortRef.current?.abort()
		const controller = new AbortController()
		abortRef.current = controller
		setLoading(true)
		try {
			const hits = await placeGeocoder.search(q, controller.signal)
			if (controller.signal.aborted) {
				return
			}
			const places: SearchResult[] = hits.map((h) => ({ ...h, source: "nominatim" as const }))
			placeResultsRef.current = { query: q.trim(), results: places }
			const all = [...hydroResultsRef.current.filter((r) => r.source !== "nominatim"), ...places]
			setResults(all)
			setSearchedPlaces(true)
			setSelectedIdx(-1)
			setNotice(places.length === 0 ? { kind: "empty", text: "No place found for that name." } : null)
		} catch (e) {
			if (!controller.signal.aborted) {
				setNotice({
					kind: "geocode",
					text: `Place search unavailable: ${e instanceof Error ? e.message : "request failed"}`,
				})
			}
		} finally {
			if (abortRef.current === controller) {
				setLoading(false)
			}
		}
	}, [])

	useEffect(() => {
		const id = window.setTimeout(() => doHydroSearch(query), 400)
		return () => window.clearTimeout(id)
	}, [query, doHydroSearch])

	useEffect(() => () => abortRef.current?.abort(), [])

	const handleSelect = (result: SearchResult) => {
		setQuery(result.label)
		setResults([])
		setSelectedIdx(-1)
		onResultSelect?.(result)
	}

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			e.preventDefault()
			if (selectedIdx >= 0 && results[selectedIdx]) {
				handleSelect(results[selectedIdx])
				return
			}
			const coord = parseCoordinateInput(query)
			if (coord) {
				handleSelect(coord)
				return
			}
			void doPlaceSearch(query)
			return
		}
		if (results.length === 0) {
			return
		}
		if (e.key === "ArrowDown") {
			e.preventDefault()
			setSelectedIdx((i) => Math.min(i + 1, results.length - 1))
		} else if (e.key === "ArrowUp") {
			e.preventDefault()
			setSelectedIdx((i) => Math.max(i - 1, 0))
		} else if (e.key === "Escape") {
			setResults([])
			setSelectedIdx(-1)
		}
	}

	const handleGoToCoord = () => {
		setCoordError("")
		const result = parseCoordinateInput(coordInput)
		if (!result) {
			setCoordError("Unrecognised format. Try: 28.45, 77.02  or  28°27'N, 77°01'E  or  44N 269000 3042000")
			return
		}
		onResultSelect?.(result)
		setCoordInput("")
	}

	const rootClass = embedded ? "map-search-root map-search-root--embedded" : "map-search-root"

	return (
		<div className={rootClass}>
			{/* ── Place / gauge / name search ── */}
			<div className="map-search-field-wrap">
				<span aria-hidden="true" className="map-search-field-icon codicon codicon-search" />
				<input
					aria-autocomplete="list"
					aria-controls="search-results-list"
					aria-expanded={results.length > 0}
					aria-label="Search places, coordinates, gauges, or dams"
					autoFocus={embedded}
					className="map-search-input"
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder="Gauge ID, dam, lat,lon — Enter to search places"
					type="text"
					value={query}
				/>
				<button
					aria-label="Search place names"
					className={`map-search-go ${chip(query.trim().length >= 2)}`}
					disabled={query.trim().length < 2}
					onClick={() => void doPlaceSearch(query)}
					title="Search place names (OpenStreetMap Nominatim)"
					type="button">
					Search
				</button>
				{loading && (
					<span aria-hidden="true" className="map-search-field-spinner codicon codicon-loading codicon-modifier-spin" />
				)}
			</div>

			{notice && (
				<div
					data-testid="map-search-notice"
					role={notice.kind === "empty" ? "status" : "alert"}
					style={{
						fontSize: 11,
						marginTop: 4,
						color:
							notice.kind === "empty"
								? "var(--vscode-descriptionForeground)"
								: "var(--vscode-editorWarning-foreground, #cca700)",
					}}>
					{notice.text}
				</div>
			)}

			{results.length > 0 && (
				<div
					aria-label={`${results.length} search results`}
					className="map-search-results"
					id="search-results-list"
					role="listbox">
					{results.map((r, idx) => (
						<button
							aria-selected={idx === selectedIdx}
							className={`map-search-result-item${idx === selectedIdx ? " map-search-result-item--selected" : ""}`}
							key={`${r.source}-${r.label}-${idx}`}
							onClick={() => handleSelect(r)}
							role="option"
							type="button">
							<span
								aria-hidden="true"
								className={`map-search-result-icon codicon codicon-${SOURCE_ICON[r.source]}`}
							/>
							<span className="map-search-result-label">{r.label}</span>
						</button>
					))}
					{searchedPlaces && results.some((r) => r.source === "nominatim") && (
						<div className="map-hint" style={{ padding: "3px 8px" }}>
							Place names © OpenStreetMap contributors (Nominatim)
						</div>
					)}
				</div>
			)}

			{/* ── Go to coordinates ── */}
			<div className="map-section map-section--ruled">
				<div className="map-section-head">
					<span className="map-section-label">
						<span aria-hidden="true" className="codicon codicon-location" />
						Go to coordinates
					</span>
				</div>
				<div className="map-row">
					<input
						aria-describedby="map-coord-hint"
						aria-invalid={coordError ? true : undefined}
						aria-label="Coordinates"
						className="map-field"
						onChange={(e) => {
							setCoordInput(e.target.value)
							setCoordError("")
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								handleGoToCoord()
							}
						}}
						placeholder="28.45, 77.02  or  44N 269000 3042000"
						type="text"
						value={coordInput}
					/>
					<button
						className={chip(!!coordInput.trim())}
						onClick={handleGoToCoord}
						title="Fly to coordinates"
						type="button">
						Go
					</button>
				</div>
				{coordError && (
					<div className="map-hint map-hint--error" role="alert">
						{coordError}
					</div>
				)}
				<div className="map-hint" id="map-coord-hint">
					Accepts decimal, DMS or UTM (zone easting northing).
				</div>
			</div>

			{/* ── Bookmarks ── */}
			<BookmarksPanel
				currentView={currentView}
				onFlyTo={(bk) =>
					onResultSelect?.({
						label: bk.name,
						lat: bk.latitude,
						lon: bk.longitude,
						source: "coordinate",
					})
				}
			/>
		</div>
	)
}

export default SearchBar
