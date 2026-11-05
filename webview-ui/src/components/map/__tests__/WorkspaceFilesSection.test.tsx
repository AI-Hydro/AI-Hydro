import type { MapLayer } from "@shared/proto/cline/map"
import { describe, expect, it } from "vitest"
import { restoredLayersNote } from "../WorkspaceFilesSection"

describe("restoredLayersNote", () => {
	const restored = (n: number, of: number) =>
		Array.from({ length: n }, (_, i) => ({
			id: `l${i}`,
			metadata: { _hydrated: "1", _hydrated_of: String(of) },
		})) as unknown as MapLayer[]

	it("is null when nothing was restored", () => {
		expect(restoredLayersNote([{ id: "x", metadata: {} } as unknown as MapLayer])).toBeNull()
	})
	it("reports the restored count honestly when the cap dropped older layers", () => {
		expect(restoredLayersNote(restored(40, 118))).toBe(
			"40 restored from earlier sessions. 78 older saved layers are kept but not loaded.",
		)
	})
	it("uses the host's authoritative older count, and reports it even when nothing is restored", () => {
		expect(restoredLayersNote(restored(40, 118), 1)).toBe(
			"40 restored from earlier sessions. 1 older saved layer is kept but not loaded.",
		)
		expect(restoredLayersNote([], 78)).toBe("78 older saved layers are kept but not loaded.")
		expect(restoredLayersNote(restored(5, 5), 0)).toBe("5 restored from earlier sessions.")
	})
	it("reports a plain count when everything was restored", () => {
		expect(restoredLayersNote(restored(5, 5))).toBe("5 restored from earlier sessions.")
	})
})
