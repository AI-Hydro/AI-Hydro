/**
 * Lint guard (UI-W S1): sub-11px text utilities and emoji in the science-facing
 * component directories may shrink but never grow. Counts are per file and live in
 * ../legibility-baseline.json.
 *
 *   npx vitest run src/design/__tests__/legibilityBudget.test.ts
 *   UPDATE_LEGIBILITY_BASELINE=1 npx vitest run ...   # lowers entries; refuses to raise any
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const SRC = resolve(__dirname, "../..")
const BASELINE = resolve(__dirname, "../legibility-baseline.json")
const GUARDED = ["evidence-board", "experiment-table", "replay-panel", "map", "chat", "welcome", "history"].map(
	(d) => `components/${d}`,
)

const SMALL_TEXT = /text-\[(?:8|9|10)px\]/g
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/gu

interface Counts {
	smallText: number
	emoji: number
}

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name)
		if (statSync(full).isDirectory()) {
			if (name === "__tests__" || name === "__mocks__") continue
			walk(full, out)
		} else if (/\.tsx$/.test(name) && !/\.(test|spec|stories)\.tsx$/.test(name)) out.push(full)
	}
	return out
}

export function scan(): Record<string, Counts> {
	const result: Record<string, Counts> = {}
	for (const dir of GUARDED) {
		for (const file of walk(join(SRC, dir))) {
			const text = readFileSync(file, "utf8")
			const smallText = (text.match(SMALL_TEXT) ?? []).length
			const emoji = (text.match(EMOJI) ?? []).length
			if (smallText || emoji) result[relative(SRC, file)] = { smallText, emoji }
		}
	}
	return result
}

describe("legibility budget (may shrink, never grow)", () => {
	const current = scan()
	const baseline: Record<string, Counts> | null = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")).files : null

	it("has a committed baseline", () => {
		expect(baseline, "legibility-baseline.json missing; create with UPDATE_LEGIBILITY_BASELINE=1").not.toBeNull()
	})

	it("does not add sub-11px text utilities or emoji to guarded components", () => {
		if (!baseline) return
		const growth: string[] = []
		for (const [file, counts] of Object.entries(current)) {
			const allowed = baseline[file] ?? { smallText: 0, emoji: 0 }
			if (counts.smallText > allowed.smallText)
				growth.push(`${file}: text-[8-10px] ${counts.smallText} > ${allowed.smallText}`)
			if (counts.emoji > allowed.emoji) growth.push(`${file}: emoji ${counts.emoji} > ${allowed.emoji}`)
		}
		expect(growth, `Use tokens/codicons instead:\n${growth.join("\n")}`).toEqual([])
	})

	it("optionally rewrites the baseline, lowering entries only", () => {
		if (!process.env.UPDATE_LEGIBILITY_BASELINE) return
		const next: Record<string, Counts> = {}
		for (const [file, counts] of Object.entries(current)) {
			const old = baseline?.[file]
			next[file] = old
				? { smallText: Math.min(counts.smallText, old.smallText), emoji: Math.min(counts.emoji, old.emoji) }
				: counts
		}
		const totals = Object.values(next).reduce(
			(a, c) => ({ smallText: a.smallText + c.smallText, emoji: a.emoji + c.emoji }),
			{ smallText: 0, emoji: 0 },
		)
		writeFileSync(
			BASELINE,
			`${JSON.stringify({ _note: "Per-file counts of text-[8px|9px|10px] and emoji in guarded component dirs. May shrink, never grow.", totals, files: next }, null, "\t")}\n`,
		)
	})
})
