import React, { createContext, useCallback, useContext, useState } from "react"

/**
 * BrushContext — Phase 3.4.4 linked map↔timeseries brushing.
 *
 * A single shared date range that both the map (time slider) and the
 * hydrography panel (hydrograph highlight) read and write.  When the user
 * drags a selection on the hydrograph, `setBrushExtent` is called with the
 * ISO date strings; the map date filter re-filters layers accordingly, and
 * vice versa.
 *
 * null = no active brush (all time steps visible).
 */
export type BrushExtent = [string, string] | null

interface BrushContextType {
	brushExtent: BrushExtent
	setBrushExtent: (extent: BrushExtent) => void
	clearBrush: () => void
}

const BrushContext = createContext<BrushContextType | undefined>(undefined)

export const BrushContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [brushExtent, setBrushExtentState] = useState<BrushExtent>(null)

	const setBrushExtent = useCallback((extent: BrushExtent) => {
		setBrushExtentState(extent)
	}, [])

	const clearBrush = useCallback(() => {
		setBrushExtentState(null)
	}, [])

	return <BrushContext.Provider value={{ brushExtent, setBrushExtent, clearBrush }}>{children}</BrushContext.Provider>
}

export const useBrushContext = (): BrushContextType => {
	const ctx = useContext(BrushContext)
	if (!ctx) {
		throw new Error("useBrushContext must be used within BrushContextProvider")
	}
	return ctx
}
