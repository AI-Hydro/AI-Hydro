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
	it("strips tags that re-form after one pass (nested-tag payload)", () => {
		expect(stripMarkdown('<<b>img src="https://evil.example/x?d=1">visible')).toBe("visible")
		expect(stripMarkdown("<scr<script>ipt>alert(1)</scr</script>ipt>")).not.toMatch(/<\/?script/i)
	})
	it("leaves an unclosed tag as inert text for the text-node renderer", () => {
		expect(stripMarkdown("see <img onerror=alert(1)")).toBe("see <img onerror=alert(1)")
	})
	it("preserves snake_case identifiers and still strips real underscore emphasis", () => {
		expect(stripMarkdown("run get_camels_attrs on a_b_c and snake_case_name")).toBe(
			"run get_camels_attrs on a_b_c and snake_case_name",
		)
		expect(stripMarkdown("an _emphasised_ word and __strong__ one")).toBe("an emphasised word and strong one")
		expect(stripMarkdown("5 * 3 * 2 and *italic*")).toBe("5 * 3 * 2 and italic")
	})
})
