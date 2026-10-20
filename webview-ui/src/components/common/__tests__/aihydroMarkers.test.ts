import remarkParse from "remark-parse"
import { unified } from "unified"
import { describe, expect, it } from "vitest"
import { remarkAiHydroMarkers } from "../MarkdownBlock"

/** Parse + run the marker plugin; return the chip `data-chip-type`s found (in order). */
function chipsIn(markdown: string): string[] {
	const processor = unified().use(remarkParse).use(remarkAiHydroMarkers)
	const tree: any = processor.runSync(processor.parse(markdown))
	const out: string[] = []
	const walk = (n: any) => {
		const t = n.data?.hProperties?.["data-chip-type"]
		if (t) out.push(t)
		for (const c of n.children ?? []) walk(c)
	}
	walk(tree)
	return out
}

describe("AI-Hydro marker chips", () => {
	it("chips plain-prose markers", () => {
		expect(chipsIn("Mean flow [run:wshed_ab12#key_outputs.q_mean] per [claim:c-1] and [lit:smith2020].")).toEqual([
			"run",
			"claim",
			"lit",
		])
	})

	it("chips an inline-code node whose entire value is one marker", () => {
		expect(chipsIn("Mean flow `[run:wshed_ab12#key_outputs.q_mean]` and `[lit:smith2020]`.")).toEqual(["run", "lit"])
	})

	it("leaves a marker embedded in longer inline code as code", () => {
		expect(chipsIn("Cite as `Fix: add [run:abc#nse] to the number`.")).toEqual([])
	})

	it("leaves a marker inside a fenced code block as code", () => {
		expect(chipsIn("```\n[run:abc#nse]\n```")).toEqual([])
	})

	it("never chips grammar placeholders (id must start alphanumeric)", () => {
		expect(chipsIn("Use [lit:...] or [lit:<tag>] or [run:<id>#<path>] or [claim:] here.")).toEqual([])
		expect(chipsIn("`[lit:...]` and `[lit:<tag>]`")).toEqual([])
		expect(chipsIn("[lit:-x] [claim:.a] [run:a#.b]")).toEqual([])
	})
})
