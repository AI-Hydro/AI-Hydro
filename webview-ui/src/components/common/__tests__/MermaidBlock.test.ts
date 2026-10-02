import mermaid from "mermaid"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

const originalGetBBox = Object.getOwnPropertyDescriptor(SVGElement.prototype, "getBBox")

describe("MermaidBlock dependency contract", () => {
	beforeAll(() => {
		Object.defineProperty(SVGElement.prototype, "getBBox", {
			configurable: true,
			value: () => ({ x: 0, y: 0, width: 100, height: 20 }),
		})
		mermaid.initialize({
			startOnLoad: false,
			securityLevel: "loose",
			theme: "dark",
		})
	})

	afterAll(() => {
		if (originalGetBBox) {
			Object.defineProperty(SVGElement.prototype, "getBBox", originalGetBBox)
		} else {
			Reflect.deleteProperty(SVGElement.prototype, "getBBox")
		}
	})

	afterEach(() => {
		document.body.replaceChildren()
	})

	it("parses and renders the production flowchart API", async () => {
		const diagram = "flowchart LR\n  rainfall[Rainfall] --> runoff[Runoff]"

		await expect(mermaid.parse(diagram, { suppressErrors: true })).resolves.toMatchObject({
			diagramType: "flowchart-v2",
		})
		await expect(mermaid.parse("not valid mermaid", { suppressErrors: true })).resolves.toBe(false)

		const { svg } = await mermaid.render("mermaid-dependency-smoke", diagram)

		expect(svg).toContain("<svg")
		expect(svg).toContain("Rainfall")
		expect(svg).toContain("Runoff")
		expect(svg).toContain("mermaid-dependency-smoke")
	})
})
