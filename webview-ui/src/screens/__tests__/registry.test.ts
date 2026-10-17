import { describe, expect, it } from "vitest"
import { screens } from "../registry"

describe("screen harness registry", () => {
	it("has unique ids and a known surface/group for every screen", () => {
		const ids = screens.map((s) => s.id)
		expect(new Set(ids).size).toBe(ids.length)
		for (const s of screens) {
			expect(["sidebar", "panel", "editor"]).toContain(s.surface)
			expect(["chat", "evidence", "experiment", "replay", "map", "studio", "design"]).toContain(s.group)
			expect(s.title.length).toBeGreaterThan(3)
		}
	})

	it("labels every map layer fixture as synthetic", () => {
		for (const s of screens) {
			for (const layer of s.layers ?? []) {
				expect(layer.metadata.source_status, `${s.id}/${layer.id}`).toBe("synthetic")
			}
		}
	})

	it("uses only fixture session and run identifiers", () => {
		for (const s of screens) {
			for (const c of s.ledger?.claims ?? []) {
				expect(c.sessionId.startsWith("fx-")).toBe(true)
				expect(c.claimId.startsWith("fx-")).toBe(true)
			}
		}
	})
})
