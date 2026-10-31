import { describe, expect, it } from "vitest"
import { gaugeInfo } from "../gaugeInfo"

describe("gaugeInfo", () => {
	it("reports only what the layer carries: the gauge layer has site, name and label", () => {
		expect(
			gaugeInfo({ site_no: "01013500", name: "Fish River near Fort Kent, Maine", label: "01013500 — Fish River" }),
		).toEqual({
			siteNo: "01013500",
			name: "Fish River near Fort Kent, Maine",
			usgsUrl: "https://waterdata.usgs.gov/monitoring-location/01013500/",
		})
	})

	it("keeps drainage area and record as reported, converting only the unit", () => {
		const info = gaugeInfo({
			site_no: "01013500",
			drain_area_va: "2690",
			record_begin: "1929-10-01",
			record_end: "2025-09-30",
		})
		expect(info?.drainageArea).toBe("6,967 km² (2,690 mi²)")
		expect(info?.periodOfRecord).toBe("1929-10-01 to 2025-09-30")
		expect(gaugeInfo({ site_no: "01013500", drainage_area_km2: 7000 })?.drainageArea).toBe("7,000 km²")
	})

	it("does not invent a record from half a pair, or a zero or negative area", () => {
		const info = gaugeInfo({ site_no: "01013500", record_begin: "1929-10-01", drain_area_va: 0 })
		expect(info?.periodOfRecord).toBeUndefined()
		expect(info?.drainageArea).toBeUndefined()
	})

	it("gives no link for an id that is not a USGS site number, and null for no site at all", () => {
		expect(gaugeInfo({ site_no: "../x" })?.usgsUrl).toBeUndefined()
		expect(gaugeInfo({ site_no: "USGS-01013500" })?.siteNo).toBe("01013500")
		expect(gaugeInfo({ name: "x" })).toBeNull()
		expect(gaugeInfo(undefined)).toBeNull()
	})
})
