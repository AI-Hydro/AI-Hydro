import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { jsPDF } from "jspdf"
import { describe, expect, it } from "vitest"

const ONE_PIXEL_JPEG =
	"data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAASABIAAD/2wBDAAICAgICAgMCAgMFAwMDBQYFBQUFBggGBgYGBggKCAgICAgICgoKCgoKCgoMDAwMDAwODg4ODg8PDw8PDw8PDw//2wBDAQICAgQEBAcEBAcQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAT/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCK4Ccf/9k="

describe("Map Plate Composer contract", () => {
	const src = readFileSync(resolve(__dirname, "../MapExport.tsx"), "utf8")

	it("separates quick export from research plate export", () => {
		expect(src).toContain("Quick Export")
		expect(src).toContain("Research Plate Export")
		expect(src).toContain("ExportReadinessReport")
	})

	it("uses extension-host persistence before emitting successful artifacts", () => {
		expect(src).toContain("prepareMapExport")
		expect(src).toContain("saveMapExport")
		expect(src).toContain("map_export.started")
		expect(src).not.toContain('document.createElement("a")')
	})

	it("records provenance for render limits and attribution", () => {
		expect(src).toContain("base64DataUrlUsed: false")
		expect(src).toContain("requiresVisibleAttribution")
		expect(src).toContain("CAPTURE_ONLY_LAYERS")
		expect(src).toContain("MAX_EXPORT_PIXELS")
	})

	it("generates PDF bytes through the production jsPDF API", () => {
		const pdf = new jsPDF({
			orientation: "landscape",
			unit: "in",
			format: [11, 8.5],
			compress: true,
		})
		pdf.setProperties({
			title: "AI-Hydro Map Plate",
			subject: "AI-Hydro research map export",
			creator: "AI-Hydro Map Plate Composer",
		})
		pdf.addImage(ONE_PIXEL_JPEG, "JPEG", 0, 0, 11, 8.5, undefined, "FAST")

		const bytes = new Uint8Array(pdf.output("arraybuffer"))
		const header = String.fromCharCode(...bytes.subarray(0, 5))

		expect(header).toBe("%PDF-")
		expect(bytes.byteLength).toBeGreaterThan(1_000)
		expect(pdf.internal.pageSize.getWidth()).toBeCloseTo(11)
		expect(pdf.internal.pageSize.getHeight()).toBeCloseTo(8.5)
	})
})
