import React, { useCallback, useEffect, useRef, useState } from "react"
import { collectHydroSearchProblems } from "./hydroSearchProblems"
import { sendHydroMapCommand } from "./mapHydrologyBridge"
import { placeGeocoder } from "./placeGeocoder"
import { loadMapWorkspace, type MapBookmark, saveMapWorkspace } from "./mapWorkspace"

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

const SOURCE_ICON: Record<SearchResult["source"], string> = {
	gauge: "🌊",
	dam: "🏗",
	coordinate: "📍",
	nominatim: "🌍",
}

const fg = "var(--vscode-foreground)"
const border = "var(--vscode-input-border, rgba(128,128,128,0.3))"
const subtle = "var(--vscode-list-hoverBackground, rgba(128,128,128,0.06))"
const accent = "var(--vscode-button-background, #0e639c)"

const smallBtn = (active?: boolean): React.CSSProperties => ({
	fontSize: 10,
	padding: "2px 7px",
	background: active ? accent : "transparent",
	color: active ? "#fff" : fg,
	border: `1px solid ${active ? accent : border}`,
	borderRadius: 3,
	cursor: "pointer",
	whiteSpace: "nowrap" as const,
})

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
		<div style={{ marginTop: 8 }}>
			<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
				<span style={{ fontSize: 10, fontWeight: 600, opacity: 0.8, flex: 1 }}>📌 Bookmarks</span>
				{currentView && !naming && (
					<button
						onClick={() => setNaming(true)}
						style={smallBtn()}
						title="Save current view as bookmark"
						type="button">
						＋ Save view
					</button>
				)}
			</div>

			{naming && (
				<div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
					<input
						autoFocus
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
						placeholder="Bookmark name…"
						style={{
							flex: 1,
							fontSize: 11,
							padding: "3px 6px",
							background: "var(--vscode-input-background)",
							color: fg,
							border: `1px solid ${border}`,
							borderRadius: 3,
						}}
						type="text"
						value={newName}
					/>
					<button onClick={saveBookmark} style={smallBtn(true)} title="Save" type="button">
						✓
					</button>
					<button
						onClick={() => {
							setNaming(false)
							setNewName("")
						}}
						style={smallBtn()}
						title="Cancel"
						type="button">
						✕
					</button>
				</div>
			)}

			{bookmarks.length === 0 ? (
				<div style={{ fontSize: 10, opacity: 0.5, padding: "4px 0", textAlign: "center" }}>
					No bookmarks yet. Navigate to a location and click ＋ Save view.
				</div>
			) : (
				<div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
					{bookmarks.map((bk) => (
						<div
							key={bk.id}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 5,
								padding: "3px 6px",
								background: subtle,
								border: `1px solid ${border}`,
								borderRadius: 3,
							}}>
							<button
								onClick={() => onFlyTo(bk)}
								style={{
									flex: 1,
									textAlign: "left",
									background: "transparent",
									border: "none",
									color: fg,
									cursor: "pointer",
									fontSize: 11,
									padding: 0,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
								title={`${bk.latitude.toFixed(4)}, ${bk.longitude.toFixed(4)} · zoom ${bk.zoom.toFixed(1)}`}
								type="button">
								{bk.name}
							</button>
							<span style={{ fontSize: 9, opacity: 0.45, whiteSpace: "nowrap" }}>z{bk.zoom.toFixed(1)}</span>
							<button
								onClick={() => removeBookmark(bk.id)}
								style={{
									background: "transparent",
									border: "none",
									color: "rgba(220,53,69,0.7)",
									cursor: "pointer",
									fontSize: 12,
									padding: 0,
									lineHeight: 1,
									flexShrink: 0,
								}}
								title="Remove bookmark"
								type="button">
								✕
							</button>
						</div>
					))}
				</div>
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
			const all = [...(coord ? [coord] : []), ...hydro]
			hydroResultsRef.current = all
			setResults(all)
			setSearchedPlaces(false)
			setSelectedIdx(-1)
			if (problems.length > 0) {
				setNotice({ kind: "problem", text: `USGS lookup incomplete: ${problems.join("; ")}` })
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
				<span aria-hidden="true" className="map-search-field-icon">
					🔍
				</span>
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
					className="map-search-go"
					disabled={query.trim().length < 2}
					onClick={() => void doPlaceSearch(query)}
					style={smallBtn(query.trim().length >= 2)}
					title="Search place names (OpenStreetMap Nominatim)"
					type="button">
					Search
				</button>
				{loading && (
					<span aria-hidden="true" className="map-search-field-spinner">
						⏳
					</span>
				)}
			</div>

			{notice && (
				<div
					data-testid="map-search-notice"
					role={notice.kind === "empty" ? "status" : "alert"}
					style={{
						fontSize: 11,
						marginTop: 4,
						color: notice.kind === "empty" ? "var(--vscode-descriptionForeground)" : "var(--vscode-editorWarning-foreground, #cca700)",
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
							<span aria-hidden="true" className="map-search-result-icon">
								{SOURCE_ICON[r.source]}
							</span>
							<span className="map-search-result-label">{r.label}</span>
						</button>
					))}
					{searchedPlaces && results.some((r) => r.source === "nominatim") && (
						<div style={{ fontSize: 11, opacity: 0.7, padding: "3px 8px" }}>
							Place names © OpenStreetMap contributors (Nominatim)
						</div>
					)}
				</div>
			)}

			{/* ── Go to coordinates ── */}
			<div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${border}` }}>
				<div style={{ fontSize: 10, fontWeight: 600, opacity: 0.8, marginBottom: 4 }}>📍 Go to coordinates</div>
				<div style={{ display: "flex", gap: 5 }}>
					<input
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
						style={{
							flex: 1,
							fontSize: 10,
							padding: "3px 6px",
							background: "rgba(255,255,255,0.07)",
							color: fg,
							border: `1px solid ${coordError ? "rgba(220,53,69,0.6)" : border}`,
							borderRadius: 3,
							minWidth: 0,
						}}
						type="text"
						value={coordInput}
					/>
					<button
						onClick={handleGoToCoord}
						style={smallBtn(!!coordInput.trim())}
						title="Fly to coordinates"
						type="button">
						Go
					</button>
				</div>
				{coordError && (
					<div
						style={{
							fontSize: 9,
							color: "var(--vscode-editorError-foreground, #f48771)",
							marginTop: 3,
							lineHeight: 1.3,
						}}>
						{coordError}
					</div>
				)}
				<div style={{ fontSize: 9, opacity: 0.4, marginTop: 3 }}>Accepts decimal · DMS · UTM (zone easting northing)</div>
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
