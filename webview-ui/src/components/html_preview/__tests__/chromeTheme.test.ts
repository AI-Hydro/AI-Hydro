import { describe, expect, it } from "vitest"
import { buildChromeCss, CHROME_TOKENS, type ChromeTokenName, chrome, KERNEL_STATES } from "../chromeTheme"
import { THEME_KINDS, type ThemeKind } from "../themeSignal"

// ---- colour maths (WCAG 2.x) -------------------------------------------------------------------

type RGBA = [number, number, number, number]

function parseColor(value: string): RGBA {
	const v = value.trim()
	if (v === "transparent") {
		return [0, 0, 0, 0]
	}
	if (v.startsWith("#")) {
		const h = v.length === 4 ? [...v.slice(1)].map((c) => c + c).join("") : v.slice(1)
		return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)).concat(1) as RGBA
	}
	const m = v.match(/rgba?\(([^)]+)\)/)
	if (!m) {
		throw new Error(`unparseable colour: ${value}`)
	}
	const p = m[1].split(",").map((x) => Number.parseFloat(x))
	return [p[0], p[1], p[2], p[3] ?? 1]
}

/** Every colour literal in a value (a gradient yields each stop). */
function colorsIn(value: string): RGBA[] {
	const found = value.match(/#[0-9a-fA-F]{6}\b|rgba?\([^)]+\)|transparent/g) ?? []
	return found.map(parseColor)
}

function over(top: RGBA, bottom: RGBA): RGBA {
	const a = top[3]
	return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1) as RGBA
}

const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const lum = (c: RGBA) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
function ratio(fg: RGBA, bg: RGBA): number {
	const f = over(fg, bg)
	const [hi, lo] = [lum(f), lum(bg)].sort((a, b) => b - a)
	return (hi + 0.05) / (lo + 0.05)
}

// ---- representative VS Code theme values (Light Modern, Dark Modern, Dark HC, Light HC) ----------

const HOST: Record<ThemeKind, { bg: string; fg: string; desc: string }> = {
	light: { bg: "#ffffff", fg: "#3b3b3b", desc: "#717171" },
	dark: { bg: "#1f1f1f", fg: "#cccccc", desc: "#9d9d9d" },
	"hc-dark": { bg: "#000000", fg: "#ffffff", desc: "#ffffff" },
	"hc-light": { bg: "#ffffff", fg: "#292929", desc: "#292929" },
}

const TEXT_MIN = 4.5
const UI_MIN = 3

/** Text token -> the surfaces it is painted on (editor bg plus each tint layered over it). */
const TEXT_PAIRS: Array<[fg: ChromeTokenName, surfaces: ChromeTokenName[]]> = [
	["accent", ["accentTint", "headerBg", "accentTintStrong", "editActiveBg", "activeBg"]],
	["ok", ["okTint", "okTintStrong", "headerBg"]],
	["warn", ["warnBg"]],
	...KERNEL_STATES.map(
		(s): [ChromeTokenName, ChromeTokenName[]] => [
			`kernel${s[0].toUpperCase()}${s.slice(1)}Fg` as ChromeTokenName,
			[`kernel${s[0].toUpperCase()}${s.slice(1)}Bg` as ChromeTokenName],
		],
	),
]

/** Non-text indicators (dots, progress fills, current-row accents). */
const UI_PAIRS: Array<[ChromeTokenName, ChromeTokenName[]]> = [
	["accent", ["track"]],
	["accent2", ["track"]],
	["ok", ["track"]],
	["ok2", ["track"]],
	...KERNEL_STATES.map(
		(s): [ChromeTokenName, ChromeTokenName[]] => [
			`kernel${s[0].toUpperCase()}${s.slice(1)}Dot` as ChromeTokenName,
			[`kernel${s[0].toUpperCase()}${s.slice(1)}Bg` as ChromeTokenName],
		],
	),
]

function surfaces(kind: ThemeKind, names: ChromeTokenName[]): RGBA[] {
	const base = parseColor(HOST[kind].bg)
	const out: RGBA[] = [base]
	for (const n of names) {
		for (const c of colorsIn(CHROME_TOKENS[kind][n])) {
			out.push(over(c, base))
		}
	}
	return out
}

describe("chrome theme tokens", () => {
	it("defines every token for every theme kind", () => {
		const names = Object.keys(CHROME_TOKENS.dark).sort()
		for (const kind of THEME_KINDS) {
			expect(Object.keys(CHROME_TOKENS[kind]).sort()).toEqual(names)
		}
	})

	it("keeps the dark look: dark accent, completed and kernel dot colours are unchanged", () => {
		expect(CHROME_TOKENS.dark.accent).toBe("#00DDFF")
		expect(CHROME_TOKENS.dark.ok).toBe("#4ade80")
		expect(CHROME_TOKENS.dark.kernelReadyDot).toBe("#89d185")
		expect(chrome.accent).toBe("var(--aihydro-chrome-accent, #00DDFF)")
	})

	it("publishes one body-class block per kind", () => {
		const css = buildChromeCss()
		expect(css).toContain("body.vscode-light:not(.vscode-high-contrast)")
		expect(css).toContain("body.vscode-high-contrast:not(.vscode-high-contrast-light)")
		expect(css).toContain("body.vscode-high-contrast-light{")
		expect(css).toContain("--aihydro-chrome-kernel-ready-fg:#176d30")
	})

	for (const kind of THEME_KINDS) {
		describe(kind, () => {
			const t = CHROME_TOKENS[kind]
			const host = HOST[kind]

			for (const [fg, on] of TEXT_PAIRS) {
				it(`text ${fg} >= ${TEXT_MIN}:1 on its surfaces`, () => {
					const fgc = parseColor(t[fg])
					for (const bg of surfaces(kind, on)) {
						expect(ratio(fgc, bg)).toBeGreaterThanOrEqual(TEXT_MIN)
					}
				})
			}

			it("badge text (onAccent on accent, onOk on ok, onDanger on danger) >= 4.5:1", () => {
				const pairs: Array<[ChromeTokenName, ChromeTokenName]> = [
					["onAccent", "accent"],
					["onOk", "ok"],
					["onDanger", "danger"],
				]
				for (const [fg, bg] of pairs) {
					expect(ratio(parseColor(t[fg]), parseColor(t[bg]))).toBeGreaterThanOrEqual(TEXT_MIN)
				}
			})

			it("theme-supplied foregrounds the chrome relies on stay legible on the editor bg", () => {
				expect(ratio(parseColor(host.fg), parseColor(host.bg))).toBeGreaterThanOrEqual(TEXT_MIN)
				expect(ratio(parseColor(host.desc), parseColor(host.bg))).toBeGreaterThanOrEqual(TEXT_MIN)
			})

			for (const [fg, on] of UI_PAIRS) {
				it(`indicator ${fg} >= ${UI_MIN}:1 on its surfaces`, () => {
					const fgc = parseColor(t[fg])
					for (const bg of surfaces(kind, on)) {
						expect(ratio(fgc, bg)).toBeGreaterThanOrEqual(UI_MIN)
					}
				})
			}

			it("solid badge fills (ok, accent) are >= 3:1 against the editor bg", () => {
				const bg = parseColor(host.bg)
				expect(ratio(parseColor(t.ok), bg)).toBeGreaterThanOrEqual(UI_MIN)
				expect(ratio(parseColor(t.accent), bg)).toBeGreaterThanOrEqual(UI_MIN)
			})
		})
	}
})
