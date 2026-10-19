/**
 * Lint guard (UI-W S1): sub-11px text utilities and emoji in the science-facing
 * component directories may shrink but never grow. Counts are per file and live in
 * ../legibility-baseline.json.
 *
 *   npx vitest run src/design/__tests__/legibilityBudget.test.ts
 *   UPDATE_LEGIBILITY_BASELINE=1 npx vitest run ...   # lowers entries; refuses to raise any
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import { describe, expect, it } from "vitest"

const SRC = resolve(__dirname, "../..")
const BASELINE = resolve(__dirname, "../legibility-baseline.json")
const GUARDED = ["evidence-board", "experiment-table", "replay-panel", "map", "chat", "welcome", "history"].map(
	(d) => `components/${d}`,
)

// Smallest acceptable rendered size, in CSS px, at the default 13px editor font (rem assumes a 16px root).
const MIN_PX = 11
const REM_PX = 16
const EM_PX = 13

const toPx = (value: number, unit: string): number => (unit === "rem" ? value * REM_PX : unit === "em" ? value * EM_PX : value)

/** Tailwind arbitrary sizes: text-[9px], text-[9.5px], text-[0.6rem], text-[0.7em]. */
const TW_SIZE = /text-\[(\d+(?:\.\d+)?)(px|rem|em)\]/g
/** Inline style props: fontSize: 10, fontSize: "9.5px", fontSize: '0.6rem'. */
const INLINE_NUM = /fontSize\s*:\s*(\d+(?:\.\d+)?)(?![\d.]|\s*["'`])/g
const INLINE_STR = /fontSize\s*:\s*["'`](\d+(?:\.\d+)?)(px|rem|em)["'`]/g
/** CSS declarations (in .css files or style strings). */
const CSS_SIZE = /font-size\s*:\s*(\d+(?:\.\d+)?)(px|rem|em)/g
/**
 * Emoji and icon-glyph characters: emoji presentation, pictographs with VS16, and the bare symbols that render as
 * emoji or pictograms without U+FE0F (warning sign, check marks, crosses, stars, misc technical, arrows-in-box).
 */
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F|[\u2300-\u23FF\u2600-\u27BF\u2B00-\u2BFF\u25A0-\u25FF]/gu

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
		} else if (/\.(tsx|css)$/.test(name) && !/\.(test|spec|stories)\.tsx$/.test(name)) out.push(full)
	}
	return out
}

export function countSmall(text: string, isCss: boolean): number {
	let n = 0
	const check = (re: RegExp, unitAt: number | null) => {
		for (const m of text.matchAll(re)) {
			const value = Number(m[1])
			const px = toPx(value, unitAt === null ? "px" : m[unitAt])
			if (px < MIN_PX) n++
		}
	}
	check(TW_SIZE, 2)
	check(INLINE_NUM, null)
	check(INLINE_STR, 2)
	if (isCss) check(CSS_SIZE, 2)
	return n
}

export function countEmoji(text: string): number {
	return (text.match(EMOJI) ?? []).length
}

export function scan(): Record<string, Counts> {
	const result: Record<string, Counts> = {}
	for (const dir of GUARDED) {
		for (const file of walk(join(SRC, dir))) {
			const text = readFileSync(file, "utf8")
			const smallText = countSmall(text, file.endsWith(".css"))
			const emoji = countEmoji(text)
			// Baseline keys are POSIX paths; Windows relative() yields backslashes.
			if (smallText || emoji) result[relative(SRC, file).split(sep).join("/")] = { smallText, emoji }
		}
	}
	return result
}

describe("legibility scanners", () => {
	it("flags fractional px, rem/em below 11px-equivalent, inline fontSize and css font-size", () => {
		expect(countSmall("text-[9px] text-[9.5px] text-[10.9px]", false)).toBe(3)
		expect(countSmall("text-[11px] text-[0.75rem] text-[0.9em]", false)).toBe(0)
		expect(countSmall("text-[0.6rem] text-[0.8em]", false)).toBe(2)
		expect(countSmall("style={{ fontSize: 10 }} style={{ fontSize: 12 }}", false)).toBe(1)
		expect(
			countSmall('style={{ fontSize: "9.5px" }} style={{ fontSize: "0.6rem" }} style={{ fontSize: "12px" }}', false),
		).toBe(2)
		expect(countSmall(".a{font-size:9px}.b{font-size:0.5rem}.c{font-size:12px}", true)).toBe(2)
		expect(countSmall(".a{font-size:9px}", false)).toBe(0)
	})

	it("flags emoji with and without U+FE0F, and bare pictograph symbols", () => {
		expect(countEmoji("\u26A0 warning")).toBe(1)
		expect(countEmoji("\u2714 done \u2713 ok \u2717 no")).toBe(3)
		expect(countEmoji("\u26A0\uFE0F")).toBe(1)
		expect(countEmoji("\u{1F5FA}\uFE0F map")).toBeGreaterThanOrEqual(1)
		expect(countEmoji("plain text, arrows \u2192 and bullets \u2022 are fine")).toBe(0)
	})
})

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
