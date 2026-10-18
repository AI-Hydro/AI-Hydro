import { cleanup, render } from "@testing-library/react"
import Fuse from "fuse.js"
import { afterEach, describe, expect, it } from "vitest"
import { stripMarkdown } from "@/utils/stripMarkdown"
import { HighlightedText, mergeMatchRegions, withMatchRegions } from "../HighlightedText"

afterEach(cleanup)

describe("HighlightedText", () => {
	it("renders a nested-tag payload as text, never as an element", () => {
		const payload = '<<b>img src="https://evil.example/x?d=1">'
		const { container } = render(<HighlightedText regions={[[0, 3]]} text={payload} />)
		expect(container.querySelector("img")).toBeNull()
		expect(container.textContent).toBe(payload)
	})

	it("renders an unclosed <img onerror= as text even when a highlight splits it", () => {
		const text = "x <img onerror=alert(1)"
		const { container } = render(<HighlightedText regions={[[2, 6]]} text={text} />)
		expect(container.querySelector("img")).toBeNull()
		expect(container.textContent).toBe(text)
		expect(container.querySelectorAll("span")).toHaveLength(1)
	})

	it("keeps snake_case identifiers intact through strip and render", () => {
		const text = stripMarkdown("compare get_camels_attrs with a_b_c")
		const { container } = render(<HighlightedText text={text} />)
		expect(container.textContent).toBe("compare get_camels_attrs with a_b_c")
	})

	it("still highlights search matches", () => {
		const tasks = [
			{ id: "1", task: "Delineate the catchment for gauge 01013500" },
			{ id: "2", task: "Unrelated question" },
		]
		const fuse = new Fuse(tasks, { keys: ["task"], threshold: 0.3, includeMatches: true, minMatchCharLength: 1 })
		const hits = withMatchRegions(fuse.search("catchment"))
		expect(hits).toHaveLength(1)
		const { container } = render(<HighlightedText regions={hits[0].matchRegions} text={hits[0].task} />)
		expect(container.textContent).toBe(tasks[0].task)
		const marked = [...container.querySelectorAll("span.history-item-highlight")].map((n) => n.textContent).join("")
		expect(marked.toLowerCase()).toContain("catchment")
	})

	it("merges overlapping and adjacent regions", () => {
		expect(
			mergeMatchRegions([
				[4, 6],
				[0, 2],
				[3, 3],
				[9, 10],
			]),
		).toEqual([
			[0, 6],
			[9, 10],
		])
	})
})
