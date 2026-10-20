import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { MAP_Z } from "../mapZ"

const mapDir = join(__dirname, "..")
const sources = readdirSync(mapDir, { recursive: true })
	.map(String)
	.filter((f) => /\.(tsx?|ts)$/.test(f) && !f.includes("__tests__") && f !== "mapZ.ts")

describe("map z-index scale", () => {
	it("is strictly ordered canvas < overlay < empty-state < panel < menu < toast < modal", () => {
		const order = [MAP_Z.canvas, MAP_Z.overlay, MAP_Z.emptyState, MAP_Z.panel, MAP_Z.menu, MAP_Z.toast, MAP_Z.modal]
		expect([...order].sort((a, b) => a - b)).toEqual(order)
		expect(new Set(order).size).toBe(order.length)
	})

	it("the empty-state card sits below every panel", () => {
		expect(MAP_Z.emptyState).toBeLessThan(MAP_Z.panel)
	})

	it("no component under components/map uses a raw numeric zIndex", () => {
		const offenders = sources.filter((file) => /zIndex:\s*-?\d/.test(readFileSync(join(mapDir, file), "utf8")))
		expect(offenders).toEqual([])
	})

	it("index.css map overlay rules use the --map-z-* variables, and the variables mirror MAP_Z", () => {
		const css = readFileSync(join(mapDir, "..", "..", "index.css"), "utf8")
		for (const [name, value] of [
			["overlay", MAP_Z.overlay],
			["panel", MAP_Z.panel],
			["menu", MAP_Z.menu],
			["toast", MAP_Z.toast],
			["modal", MAP_Z.modal],
		] as const) {
			expect(css).toContain(`--map-z-${name}: ${value};`)
		}
		for (const selector of [".map-search-container", ".map-bottom-bar", ".map-export-panel", ".map-cluster-legend"]) {
			const block = css.slice(css.indexOf(`${selector} {`), css.indexOf("}", css.indexOf(`${selector} {`)))
			expect(block, selector).toMatch(/z-index: var\(--map-z-/)
		}
	})
})
