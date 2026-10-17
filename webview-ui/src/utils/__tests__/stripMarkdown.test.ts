import { describe, expect, it } from "vitest"
import { stripMarkdown } from "../stripMarkdown"

describe("stripMarkdown", () => {
	it("removes emphasis, code ticks and link syntax but keeps the text", () => {
		expect(stripMarkdown("**Delineate** the catchment for `SYN-1` and [signatures](run:fx-run-0003)")).toBe(
			"Delineate the catchment for SYN-1 and signatures",
		)
	})
	it("handles headings, lists, blockquotes, images and html tags", () => {
		expect(stripMarkdown("# Title\n- item one\n> quoted\n![alt text](x.png) <b>bold</b>")).toBe(
			"Title item one quoted alt text bold",
		)
	})
	it("drops fenced code and collapses whitespace", () => {
		expect(stripMarkdown("before\n```js\nconst a = 1\n```\n  after")).toBe("before after")
	})
	it("leaves plain text alone", () => {
		expect(stripMarkdown("Why did the gauge lookup stop?")).toBe("Why did the gauge lookup stop?")
	})
})
