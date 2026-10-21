import { extractEvidence } from "@shared/aihydro/evidenceMarkers"
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

describe("shared marker helper parity (answer evidence summary)", () => {
	const samples = [
		"Mean flow [run:wshed_ab12#key_outputs.q_mean] per [claim:c-1] and [lit:smith2020].",
		"`[run:a#b]` and `[claim:c-2]` and [lit:x]",
		"Use [lit:...] or [lit:<tag>] or [claim:] here; `Fix: add [run:abc#nse] to it`",
		"```\n[run:abc#nse]\n```\n[claim:c-3]",
		"~~~md\n[claim:c-9]\n~~~\ntext [claim:c-4]",
		"text\n```js\nconst a = '[claim:c-5]'\n```\nafter `x [run:r#p] y` and `[run:r2#p2]` and ``[claim:c-6]``",
		"tail\n```\n[claim:c-7] never closed",
	]
	const count = (e: ReturnType<typeof extractEvidence>) => e.runs.length + e.claims.length + e.lits.length

	it("the summary finds exactly the markers the markdown plugin chips (all samples are distinct markers)", () => {
		for (const md of samples) {
			expect(count(extractEvidence(md)), md).toBe(chipsIn(md).length)
		}
	})

	it("the same markers, by kind, in the same order", () => {
		for (const md of samples) {
			const e = extractEvidence(md)
			const byKind = { run: e.runs.length, claim: e.claims.length, lit: e.lits.length }
			const chips = chipsIn(md)
			expect(
				{
					run: chips.filter((c) => c === "run").length,
					claim: chips.filter((c) => c === "claim").length,
					lit: chips.filter((c) => c === "lit").length,
				},
				md,
			).toEqual(byKind)
		}
	})
})
