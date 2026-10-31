/**
 * What a clicked gauge says about itself. Only what the layer's own properties carry: the map's gauge layer lists
 * site number, name and label, so drainage area and period of record are "not reported" until a layer reports them.
 * Nothing here is looked up, converted beyond the unit, or guessed.
 */
export interface GaugeInfo {
	siteNo: string
	name?: string
	/** The USGS monitoring-location page for this site. */
	usgsUrl?: string
	/** As reported, with its unit. */
	drainageArea?: string
	/** As reported. */
	periodOfRecord?: string
}

const SQMI_TO_KM2 = 2.589988
/** A USGS site number is 8 to 15 digits. Anything else gets no link: the URL is built from it. */
const SITE_NO = /^\d{8,15}$/

const str = (value: unknown): string | undefined => {
	if (typeof value === "string" && value.trim()) {
		return value.trim()
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value)
	}
	return undefined
}

const num = (value: unknown): number | undefined => {
	const text = str(value)
	const n = text === undefined ? Number.NaN : Number(text)
	return Number.isFinite(n) && n > 0 ? n : undefined
}

function fmtKm2(km2: number): string {
	return km2 >= 100 ? `${Math.round(km2).toLocaleString("en-US")} km²` : `${km2.toFixed(1)} km²`
}

export function gaugeInfo(props: Record<string, unknown> | undefined): GaugeInfo | null {
	const siteNo = str(props?.site_no ?? props?.siteNo ?? props?.monitoring_location_id)?.replace(/^USGS-/i, "")
	if (!siteNo) {
		return null
	}
	const km2 = num(props?.drainage_area_km2 ?? props?.drain_area_km2)
	const sqmi = num(props?.drainage_area_sqmi ?? props?.drain_area_va)
	const drainageArea = km2
		? fmtKm2(km2)
		: sqmi
			? `${fmtKm2(sqmi * SQMI_TO_KM2)} (${sqmi.toLocaleString("en-US")} mi²)`
			: undefined
	const begin = str(props?.record_begin ?? props?.begin_date)
	const end = str(props?.record_end ?? props?.end_date)
	const periodOfRecord = str(props?.period_of_record) ?? (begin && end ? `${begin} to ${end}` : undefined)
	return {
		siteNo,
		name: str(props?.name),
		...(SITE_NO.test(siteNo) ? { usgsUrl: `https://waterdata.usgs.gov/monitoring-location/${siteNo}/` } : {}),
		...(drainageArea ? { drainageArea } : {}),
		...(periodOfRecord ? { periodOfRecord } : {}),
	}
}

/** The property keys the gauge block already shows, so the property list does not repeat them. */
export const GAUGE_BLOCK_KEYS = new Set(["site_no", "siteNo", "monitoring_location_id", "name", "label"])
