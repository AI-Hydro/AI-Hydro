/**
 * Bundled Natural Earth 1:50m rivers and lakes (public domain): the offline tier and the low-zoom tier of the
 * river layer. Built by `scripts/basemap/build-natural-earth-hydro.py` (coordinates rounded to 0.01 degree, lines
 * simplified at 0.02 degree), so this is a coarse picture: it is for world and continental views, and it is what
 * the map falls back to when the GEOGLOWS tiles cannot be reached. It is not drawn at regional zoom when the
 * streamed tier works, because the two generalisations of the same river would not coincide.
 */
import data from "./naturalEarthHydro.json"
import { orderFromNaturalEarthRank } from "./riverStyle"

export interface NaturalEarthRiver {
	path: [number, number][]
	/** Strahler-order stand-in derived from Natural Earth's scalerank (see orderFromNaturalEarthRank). */
	order: number
}

/** A lake polygon: ring 0 is the shore, the rest are islands. Rings are [lon, lat] pairs. */
export type NaturalEarthLake = [number, number][][]

type Raw = { rivers: [number, number[]][]; lakes: number[][][] }

function pairs(flat: number[]): [number, number][] {
	const out: [number, number][] = []
	for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]])
	return out
}

let cache: { rivers: NaturalEarthRiver[]; lakes: NaturalEarthLake[] } | undefined

/** Decoded once on first use, sorted so larger rivers are drawn last. */
export function naturalEarthHydro(raw: Raw = data as Raw): { rivers: NaturalEarthRiver[]; lakes: NaturalEarthLake[] } {
	if (raw === (data as Raw) && cache) return cache
	const rivers = raw.rivers
		.map(([rank, flat]) => ({ path: pairs(flat), order: orderFromNaturalEarthRank(rank) }))
		.sort((a, b) => a.order - b.order)
	const lakes = raw.lakes.map((rings) => rings.map(pairs))
	const decoded = { rivers, lakes }
	if (raw === (data as Raw)) cache = decoded
	return decoded
}
