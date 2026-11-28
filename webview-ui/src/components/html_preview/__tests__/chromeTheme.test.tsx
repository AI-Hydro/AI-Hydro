import { render } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { CourseHeader } from "../CourseHeader"
import { CourseNavigator } from "../CourseNavigator"
import { KernelStatusChip } from "../KernelStatusChip"
import type { CourseManifest } from "../useCourse"
import type { CourseProgressHook } from "../useCourseProgress"
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
// Hand-entered from the published default themes, not captured from a running VS Code.
// Light description text uses #717171 (the stricter value); sidebar is where the navigator sits.

const HOST: Record<ThemeKind, { bg: string; sidebar: string; fg: string; desc: string; err: string; sel: string }> = {
	light: { bg: "#ffffff", sidebar: "#f8f8f8", fg: "#3b3b3b", desc: "#717171", err: "#f85149", sel: "#0060c0" },
	dark: { bg: "#1f1f1f", sidebar: "#181818", fg: "#cccccc", desc: "#9d9d9d", err: "#f85149", sel: "#04395e" },
	"hc-dark": { bg: "#000000", sidebar: "#000000", fg: "#ffffff", desc: "#ffffff", err: "#f48771", sel: "#000000" },
	"hc-light": { bg: "#ffffff", sidebar: "#ffffff", fg: "#292929", desc: "#292929", err: "#b5200d", sel: "#ffffff" },
}

const TEXT_MIN = 4.5
const UI_MIN = 3

/** A token value, resolving the `var(--vscode-*)` forms a token may carry to the representative host value. */
function value(kind: ThemeKind, token: ChromeTokenName): string {
	const v = CHROME_TOKENS[kind][token]
	if (v.startsWith("var(--vscode-descriptionForeground")) {
		return HOST[kind].desc
	}
	if (v.startsWith("var(--vscode-errorForeground")) {
		return HOST[kind].err
	}
	return v
}

const K = (s: string) => s[0].toUpperCase() + s.slice(1)
const kn = (s: string, part: string) => `kernel${K(s)}${part}` as ChromeTokenName
const cap = (c: string, part: string) => `${c}${part}` as ChromeTokenName
const CAPS = ["capExecutable", "capModule", "capPack", "capStatic"]

/** Each entry is a text colour and the layered surfaces it is painted on; a chain stacks tints bottom to top. */
const TEXT_PAIRS: Array<[fg: ChromeTokenName, chains: ChromeTokenName[][]]> = [
	[
		"accent",
		[
			["accentTint"],
			["headerBg"],
			["accentTintStrong"],
			["editActiveBg"],
			["activeBg"],
			["ribbonBg"],
			["cardBg"],
			["accentTintMid"],
		],
	],
	["ok", [["okTint"], ["okTintStrong"], ["headerBg"]]],
	["warn", [["warnBg"]]],
	// Description text on every tint it is painted on (navigator rows, header, ribbon, cards, toasts).
	[
		"textDesc",
		[
			["accentTint"],
			["accentTintMid"],
			["okTint"],
			["okTintStrong"],
			["badge"],
			["badgeLocked"],
			["hover"],
			["hoverNav"],
			["hoverCard"],
			["tintFaint"],
			["headerBg"],
			["ribbonBg"],
			["cardBg"],
			["warnBg"],
		],
	],
	["errFg", [["errBg"]]],
	["textMuted", [["cardBg"], ["modalBg"]]],
	["textStrong", [["cardBg"], ["modalBg"]]],
	["dangerFg", [["dangerBg"], ["modalBg", "dangerBg"]]],
	["savingFg", [["modalBg", "savingBg"]]],
	...KERNEL_STATES.map((s): [ChromeTokenName, ChromeTokenName[][]] => [kn(s, "Fg"), [[kn(s, "Bg")]]]),
	...CAPS.map((c): [ChromeTokenName, ChromeTokenName[][]] => [cap(c, "Fg"), [[cap(c, "Bg")]]]),
]

/** Non-text indicators (dots, progress fills, current-row accents). */
const UI_PAIRS: Array<[ChromeTokenName, ChromeTokenName[][]]> = [
	["accent", [["track"]]],
	["accent2", [["track"]]],
	["ok", [["track"]]],
	["ok2", [["track"]]],
	...KERNEL_STATES.map((s): [ChromeTokenName, ChromeTokenName[][]] => [kn(s, "Dot"), [[kn(s, "Bg")]]]),
]

function surfaces(kind: ThemeKind, chains: ChromeTokenName[][], editorOnly = false): RGBA[] {
	const out: RGBA[] = []
	for (const base of editorOnly ? [HOST[kind].bg] : [HOST[kind].bg, HOST[kind].sidebar]) {
		out.push(parseColor(base))
		for (const chain of chains) {
			// Gradients contribute every stop; stack the chain over the base.
			let layers: RGBA[] = [parseColor(base)]
			for (const t of chain) {
				const stops = colorsIn(value(kind, t))
				layers = layers.flatMap((l) => stops.map((c) => over(c, l)))
			}
			out.push(...layers)
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

	it("keeps the dark look: the previous dark values are unchanged except the failing kernel ones", () => {
		const d = CHROME_TOKENS.dark
		expect(d.accent).toBe("#00DDFF")
		expect(d.ok).toBe("#4ade80")
		expect(d.hoverMenu).toBe("rgba(255,255,255,0.08)")
		expect(d.divider).toBe("rgba(255,255,255,0.08)")
		expect(d.hoverNav).toBe("rgba(255,255,255,0.04)")
		expect(d.badgeLocked).toBe("rgba(125,211,252,0.06)")
		expect(d.accentTintMid).toBe("rgba(0,221,255,0.12)")
		expect(d.lineSoft).toBe("rgba(125,211,252,0.18)")
		expect(d.kernelReadyDot).toBe("#89d185")
		expect(d.kernelStoppedFg).toBe("#8f8f8f")
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
			const host = HOST[kind]

			for (const [fg, chains] of TEXT_PAIRS) {
				it(`text ${fg} >= ${TEXT_MIN}:1 on its surfaces (editor and sidebar bg)`, () => {
					const fgc = parseColor(value(kind, fg))
					for (const bg of surfaces(kind, chains, fg.startsWith("kernel"))) {
						expect(ratio(fgc, bg)).toBeGreaterThanOrEqual(TEXT_MIN)
					}
				})
			}

			it("text on solid buttons and badges >= 4.5:1 across every gradient stop", () => {
				const pairs: Array<[ChromeTokenName, ChromeTokenName]> = [
					["onAccent", "accent"],
					["onOk", "ok"],
					["onDanger", "danger"],
					["onBtn", "btnGrad"],
					["onOkGrad", "okGrad"],
				]
				for (const [fg, bg] of pairs) {
					for (const stop of colorsIn(value(kind, bg))) {
						expect(ratio(parseColor(value(kind, fg)), stop)).toBeGreaterThanOrEqual(TEXT_MIN)
					}
				}
			})

			it("secondary text on the active list selection >= 4.5:1", () => {
				expect(ratio(parseColor(value(kind, "selMeta")), parseColor(host.sel))).toBeGreaterThanOrEqual(TEXT_MIN)
			})

			it("theme-supplied foregrounds the chrome relies on stay legible on editor and sidebar bg", () => {
				for (const bg of [host.bg, host.sidebar]) {
					expect(ratio(parseColor(host.fg), parseColor(bg))).toBeGreaterThanOrEqual(TEXT_MIN)
					expect(ratio(parseColor(host.desc), parseColor(bg))).toBeGreaterThanOrEqual(TEXT_MIN)
				}
			})

			for (const [fg, chains] of UI_PAIRS) {
				it(`indicator ${fg} >= ${UI_MIN}:1 on its surfaces`, () => {
					const fgc = parseColor(value(kind, fg))
					for (const bg of surfaces(kind, chains, fg.startsWith("kernel"))) {
						expect(ratio(fgc, bg)).toBeGreaterThanOrEqual(UI_MIN)
					}
				})
			}

			it("solid badge fills (ok, accent) are >= 3:1 against editor and sidebar bg", () => {
				for (const bg of [host.bg, host.sidebar]) {
					expect(ratio(parseColor(value(kind, "ok")), parseColor(bg))).toBeGreaterThanOrEqual(UI_MIN)
					expect(ratio(parseColor(value(kind, "accent")), parseColor(bg))).toBeGreaterThanOrEqual(UI_MIN)
				}
			})
		})
	}
})

// ---- wiring: no component may paint a dark-only literal ------------------------------------------

const BANNED = [/#00DDFF/i, /#4ade80/i, /rgba\(255,\s*255,\s*255,/]

const course: CourseManifest = {
	courseId: "c",
	title: "Course",
	authors: [{ name: "A" }],
	version: "1.0",
	estimatedHours: 2,
	modules: [
		{ id: "m1", path: "m1/module.html", title: "One", estimatedMinutes: 10 },
		{ id: "m2", path: "m2/module.html", title: "Two", prerequisites: ["m1"] },
	],
} as CourseManifest

const progress = {
	progress: { courseId: "c", startedAt: 1, lastVisitedAt: 1, currentModuleId: "m1", completed: { m1: { completedAt: 1 } } },
	loading: false,
	isCompleted: (id: string) => id === "m1",
	canAccess: (m: { id: string }) => m.id === "m1",
	missingPrerequisites: () => [],
	completionPct: 50,
	markComplete: vi.fn(),
	markUncomplete: vi.fn(),
	reset: vi.fn(),
	setCurrent: vi.fn(),
	refresh: vi.fn(),
} as unknown as CourseProgressHook

function styleAttrs(container: HTMLElement): string {
	return Array.from(container.querySelectorAll("[style]"))
		.map((el) => el.getAttribute("style") ?? "")
		.join("\n")
}

describe("chrome wiring", () => {
	const cases: Array<[string, () => HTMLElement]> = [
		[
			"CourseHeader",
			() =>
				render(<CourseHeader course={course} currentModuleId="m2" onNavigate={() => {}} progress={progress} />).container,
		],
		[
			"CourseNavigator",
			() =>
				render(<CourseNavigator course={course} currentModuleId="m1" onNavigate={() => {}} progress={progress} />)
					.container,
		],
		["KernelStatusChip", () => render(<KernelStatusChip kernelInfo={null} />).container],
	]
	for (const [name, mount] of cases) {
		it(`${name} renders no dark-only literal colours`, () => {
			const raw = styleAttrs(mount())
			expect(raw).toContain("--aihydro-chrome-")
			const css = raw.replace(/var\(--aihydro-chrome-[\w-]+,[^)]*\)/g, "")
			for (const re of BANNED) {
				expect(css).not.toMatch(re)
			}
		})
	}

	// Components that need a full host to render (toolbar, panel, ribbon, comments, view modal) are checked at source level.
	const sources = [
		"CourseHeader.tsx",
		"CourseNavigator.tsx",
		"KernelStatusChip.tsx",
		"HtmlPreviewToolbar.tsx",
		"HtmlPreviewPanel.tsx",
		"EditContextRibbon.tsx",
		"CommentSidebar.tsx",
		"HtmlPreviewView.tsx",
	]
	for (const file of sources) {
		it(`${file} has no dark-only colour literals`, () => {
			const src = readFileSync(join(__dirname, "..", file), "utf8")
				.split("\n")
				.filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
				.join("\n")
			expect(src).not.toMatch(/#00DDFF/i)
			expect(src).not.toMatch(/#4ade80/i)
			// Allowed: `var(--vscode-*, rgba(255,255,255,...))` fallbacks of VS Code variables.
			expect(src.replace(/var\(--vscode-[\w-]+,\s*rgba\(255,\s*255,\s*255,[^)]*\)\)/g, "")).not.toMatch(
				/rgba\(255,\s*255,\s*255,/,
			)
		})
	}
})
