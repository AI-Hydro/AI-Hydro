import { describe, expect, it } from "vitest"
import { AIHYDRO_PREVIEW_STYLE, CELL_BRIDGE_SCRIPT } from "../aihydroCellBridge"
import { applyInstalledPackCsp, INSTALLED_PACK_CSP } from "../installedPackCsp"
import {
	buildThemeScript,
	buildThemeTokenCss,
	isThemeKind,
	THEME_KINDS,
	THEME_TOKENS,
	type ThemeKind,
	type ThemeTokenName,
	themeKindFromBodyClasses,
} from "../themeSignal"

// ---- colour maths (WCAG 2.x relative luminance; CIE L*a*b* for separation) ------------------

type RGB = [number, number, number]

function hexToRgb(hex: string): RGB {
	const h = hex.replace("#", "")
	return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255) as RGB
}
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function luminance(rgb: RGB): number {
	const [r, g, b] = rgb.map(toLinear)
	return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a: string, b: string): number {
	const la = luminance(hexToRgb(a))
	const lb = luminance(hexToRgb(b))
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

type Mat = [[number, number, number], [number, number, number], [number, number, number]]
// Machado, Oliveira & Fernandes (2009), severity 1.0, linear RGB.
const CVD: Record<string, Mat> = {
	protan: [
		[0.152286, 1.052583, -0.204868],
		[0.114503, 0.786281, 0.099216],
		[-0.003882, -0.048116, 1.051998],
	],
	deutan: [
		[0.367322, 0.860646, -0.227968],
		[0.280085, 0.672501, 0.047413],
		[-0.01182, 0.04294, 0.968881],
	],
	tritan: [
		[1.255528, -0.076749, -0.178779],
		[-0.078411, 0.930809, 0.147602],
		[0.004733, 0.691367, 0.3039],
	],
}

function simulate(rgb: RGB, m: Mat): RGB {
	const lin = rgb.map(toLinear)
	return m.map((row) => {
		const v = row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]
		return toSrgb(Math.min(1, Math.max(0, v)))
	}) as RGB
}
function lab(rgb: RGB): [number, number, number] {
	const [r, g, b] = rgb.map(toLinear)
	const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
	const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
	const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883
	const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
	return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}
function deltaE(a: RGB, b: RGB): number {
	const [l1, a1, b1] = lab(a)
	const [l2, a2, b2] = lab(b)
	return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}
function minPairwiseDeltaE(hexes: string[], sim?: Mat): number {
	const rgbs = hexes.map((h) => (sim ? simulate(hexToRgb(h), sim) : hexToRgb(h)))
	let min = Number.POSITIVE_INFINITY
	for (let i = 0; i < rgbs.length; i++) {
		for (let j = i + 1; j < rgbs.length; j++) {
			min = Math.min(min, deltaE(rgbs[i], rgbs[j]))
		}
	}
	return min
}

const SERIES: ThemeTokenName[] = ["--hy-series-1", "--hy-series-2", "--hy-series-3", "--hy-series-4", "--hy-series-5"]
const TEXT_TOKENS: ThemeTokenName[] = ["--hy-fg", "--hy-fg-muted", "--hy-link", "--hy-accent", "--hy-ok", "--hy-warn", "--hy-err"]
const NON_TEXT_TOKENS: ThemeTokenName[] = ["--hy-axis", "--hy-outline", ...SERIES]

// ---- signal mapping (T4) --------------------------------------------------------------------

describe("themeKindFromBodyClasses", () => {
	it("maps VS Code body classes to the four kinds", () => {
		expect(themeKindFromBodyClasses("vscode-light")).toBe("light")
		expect(themeKindFromBodyClasses("vscode-dark")).toBe("dark")
		expect(themeKindFromBodyClasses("vscode-high-contrast")).toBe("hc-dark")
		expect(themeKindFromBodyClasses("vscode-high-contrast-light")).toBe("hc-light")
	})
	it("lets the high-contrast class win when VS Code also sets light/dark", () => {
		expect(themeKindFromBodyClasses("vscode-light vscode-high-contrast-light")).toBe("hc-light")
		expect(themeKindFromBodyClasses("vscode-dark vscode-high-contrast")).toBe("hc-dark")
	})
	it("defaults to dark with no classes and accepts a DOMTokenList", () => {
		expect(themeKindFromBodyClasses("")).toBe("dark")
		expect(themeKindFromBodyClasses(undefined)).toBe("dark")
		const el = document.createElement("div")
		el.className = "vscode-light extra"
		expect(themeKindFromBodyClasses(el.classList)).toBe("light")
	})
	it("isThemeKind accepts exactly the four kinds", () => {
		for (const k of THEME_KINDS) expect(isThemeKind(k)).toBe(true)
		expect(isThemeKind("blue")).toBe(false)
		expect(isThemeKind(undefined)).toBe(false)
	})
})

describe("injected theme script", () => {
	function run(initial: ThemeKind, parent: unknown) {
		const body = buildThemeScript(initial)
			.replace(/^<script>/, "")
			.replace(/<\/script>$/, "")
		const listeners: Record<string, (e: unknown) => void> = {}
		const posted: unknown[] = []
		const events: string[] = []
		const attrs: Record<string, string> = {}
		const win: Record<string, unknown> = {
			parent,
			addEventListener: (t: string, fn: (e: unknown) => void) => {
				listeners[t] = fn
			},
		}
		;(parent as { postMessage: (m: unknown) => void }).postMessage = (m) => posted.push(m)
		const doc = {
			documentElement: {
				setAttribute: (k: string, v: string) => {
					attrs[k] = v
				},
				getAttribute: (k: string) => attrs[k],
				style: {} as Record<string, string>,
			},
			dispatchEvent: (e: { type: string }) => {
				events.push(e.type)
			},
		}
		const CustomEventStub = function (this: { type: string }, type: string) {
			this.type = type
		}
		new Function("window", "document", "CustomEvent", body)(win, doc, CustomEventStub)
		return { win, doc, attrs, listeners, posted, events }
	}

	it("sets the attribute and colour-scheme from the baked initial kind, before any other script", () => {
		const parent = {}
		const r = run("light", parent)
		expect(r.attrs["data-aihydro-theme"]).toBe("light")
		expect(r.doc.documentElement.style.colorScheme).toBe("light")
		expect(r.win.__aihydroThemeKind).toBe("light")
		expect(r.events).toContain("aihydro-theme-change")
		expect(r.posted).toEqual([{ type: "aihydro-theme-request" }])
	})
	it("updates live from a parent message and ignores other sources and bad kinds", () => {
		const parent = {}
		const r = run("dark", parent)
		const onMessage = r.listeners.message
		onMessage({ source: parent, data: { type: "aihydro-theme", kind: "hc-light" } })
		expect(r.attrs["data-aihydro-theme"]).toBe("hc-light")
		expect(r.doc.documentElement.style.colorScheme).toBe("light")
		onMessage({ source: {}, data: { type: "aihydro-theme", kind: "dark" } })
		expect(r.attrs["data-aihydro-theme"]).toBe("hc-light")
		onMessage({ source: parent, data: { type: "aihydro-theme", kind: "neon" } })
		expect(r.attrs["data-aihydro-theme"]).toBe("hc-light")
		onMessage({ source: parent, data: { type: "other", kind: "dark" } })
		expect(r.attrs["data-aihydro-theme"]).toBe("hc-light")
	})
	it("is allowed by the installed-pack CSP: inline, no network, and survives CSP injection", () => {
		expect(INSTALLED_PACK_CSP).toContain("script-src 'unsafe-inline'")
		const script = buildThemeScript("light")
		expect(script).not.toMatch(/\b(fetch|XMLHttpRequest|eval|importScripts)\b|new Function|src=/)
		const out = applyInstalledPackCsp(`<html><head>${script}</head><body></body></html>`, undefined)
		expect(out).toContain("data-aihydro-theme")
		expect(out).toContain("Content-Security-Policy")
	})
})

// ---- token contrast and CVD separation (T1) -------------------------------------------------

describe("theme tokens", () => {
	it("reports the measured separations (informational)", () => {
		const out: string[] = []
		for (const kind of THEME_KINDS) {
			const hexes = SERIES.map((n) => THEME_TOKENS[kind][n])
			out.push(
				`${kind}: normal ${minPairwiseDeltaE(hexes).toFixed(1)}, protan ${minPairwiseDeltaE(hexes, CVD.protan).toFixed(1)}, deutan ${minPairwiseDeltaE(hexes, CVD.deutan).toFixed(1)}, tritan ${minPairwiseDeltaE(hexes, CVD.tritan).toFixed(1)}`,
			)
		}
		console.info(out.join("\n"))
		expect(out).toHaveLength(4)
	})

	const LIGHT_KINDS: ThemeKind[] = ["light", "hc-light"]
	for (const kind of THEME_KINDS) {
		const t = THEME_TOKENS[kind]
		describe(kind, () => {
			it("text tokens reach 4.5:1 on bg, surface (and 7:1 for body text)", () => {
				for (const name of TEXT_TOKENS) {
					for (const ground of ["--hy-bg", "--hy-surface"] as const) {
						expect(contrast(t[name], t[ground]), `${name} on ${ground}`).toBeGreaterThanOrEqual(4.5)
					}
				}
				expect(contrast(t["--hy-fg"], t["--hy-bg"])).toBeGreaterThanOrEqual(7)
				expect(contrast(t["--hy-fg"], t["--hy-surface"])).toBeGreaterThanOrEqual(7)
			})
			it("axis, outline and series reach 3:1 on bg, surface and stage (WCAG 1.4.11)", () => {
				for (const name of NON_TEXT_TOKENS) {
					for (const ground of ["--hy-bg", "--hy-surface", "--hy-stage"] as const) {
						expect(contrast(t[name], t[ground]), `${name} on ${ground}`).toBeGreaterThanOrEqual(3)
					}
				}
			})
			it("series are distinguishable for normal vision", () => {
				expect(minPairwiseDeltaE(SERIES.map((n) => t[n]))).toBeGreaterThanOrEqual(15)
			})
		})
	}

	// High-contrast series cannot be separated by colour alone (study 3.3): lessons add dash
	// patterns there, so the CVD gate applies to the two standard themes only.
	for (const kind of ["light", "dark"] as ThemeKind[]) {
		for (const [name, mat] of Object.entries(CVD)) {
			it(`${kind} series stay separable under ${name} simulation (min dE >= 10)`, () => {
				const t = THEME_TOKENS[kind]
				expect(
					minPairwiseDeltaE(
						SERIES.map((n) => t[n]),
						mat,
					),
				).toBeGreaterThanOrEqual(10)
			})
		}
	}

	it("the default Plotly colorway it replaces was NOT CVD-safe (the check can fail)", () => {
		const old = ["#00DDFF", "#00A3FF", "#7DD3FC", "#34d399", "#a78bfa"]
		expect(minPairwiseDeltaE(old, CVD.deutan)).toBeLessThan(10)
	})

	it("light kinds have a light page and dark kinds a dark page", () => {
		for (const kind of THEME_KINDS) {
			const l = luminance(hexToRgb(THEME_TOKENS[kind]["--hy-bg"]))
			expect(l > 0.5, kind).toBe(LIGHT_KINDS.includes(kind))
		}
	})

	it("emitted css is zero-specificity and covers every kind plus the no-signal fallbacks", () => {
		const css = buildThemeTokenCss()
		for (const kind of THEME_KINDS) expect(css).toContain(`:where(:root[data-aihydro-theme="${kind}"])`)
		expect(css).toContain(":where(:root:not([data-aihydro-theme]))")
		expect(css).toContain("prefers-color-scheme: dark")
		// every rule header starts with :where( or an @media wrapper around it
		for (const line of css.split("\n")) expect(line).toMatch(/^(:where\(|@media \(prefers-color-scheme: dark\) \{ :where\()/)
	})
})

// ---- the preview style stops forcing dark ---------------------------------------------------

describe("AIHYDRO_PREVIEW_STYLE theming", () => {
	it("no longer paints the module shell dark: shell colours come from tokens at zero specificity", () => {
		expect(AIHYDRO_PREVIEW_STYLE).not.toContain("#0a0a15")
		expect(AIHYDRO_PREVIEW_STYLE).not.toMatch(/--aihydro-bg-deep:\s*#/)
		expect(AIHYDRO_PREVIEW_STYLE).toMatch(
			/:where\(body\.aihydro-module, \.aihydro-module\)\s*\{\s*background: var\(--aihydro-bg-deep\)/,
		)
	})
	it("carries the token fallbacks for every kind", () => {
		for (const kind of THEME_KINDS) expect(AIHYDRO_PREVIEW_STYLE).toContain(`data-aihydro-theme="${kind}"`)
	})
	it("component classes use no hard-coded dark rgba tints", () => {
		expect(AIHYDRO_PREVIEW_STYLE).not.toMatch(/rgba\((0,\s?221|0,\s?163|125,\s?211|15,\s?15,\s?30|10,\s?10,\s?21)/)
	})
})

describe("CELL_BRIDGE_SCRIPT theming (P0 defects)", () => {
	it("Plotly default is token-driven and no longer the three-cyan colorway", () => {
		expect(CELL_BRIDGE_SCRIPT).not.toContain('"#00DDFF", "#00A3FF", "#7DD3FC"')
		expect(CELL_BRIDGE_SCRIPT).not.toContain("#cfe8ff")
		expect(CELL_BRIDGE_SCRIPT).toContain("themeSeries()")
		expect(CELL_BRIDGE_SCRIPT).toContain("--hy-axis")
	})
	it("3-D scene uses the stage token and white, untinted lights", () => {
		expect(CELL_BRIDGE_SCRIPT).not.toContain("0x88bbff")
		expect(CELL_BRIDGE_SCRIPT).not.toContain("0x0a1622")
		expect(CELL_BRIDGE_SCRIPT).toContain("new THREE.AmbientLight(0xffffff")
		expect(CELL_BRIDGE_SCRIPT).toContain("new THREE.DirectionalLight(0xffffff")
		expect(CELL_BRIDGE_SCRIPT).toContain('themeColor("--hy-stage")')
	})
	it("repaints the stage only while the bridge still owns scene.background (no race with a lesson's fixed plate)", () => {
		expect(CELL_BRIDGE_SCRIPT).toContain("bridgeBg = new THREE.Color(")
		expect(CELL_BRIDGE_SCRIPT).toContain("ctx.scene.background === bridgeBg")
		expect(CELL_BRIDGE_SCRIPT).not.toMatch(/scene\.background = new THREE\.Color\(themeColor/)
	})
	it("still parses as JavaScript after the theme helpers were added", () => {
		const body = CELL_BRIDGE_SCRIPT.replace(/^<script>/, "").replace(/<\/script>$/, "")
		expect(() => new Function(body)).not.toThrow()
	})
	it("exposes aihydro.theme", () => {
		expect(CELL_BRIDGE_SCRIPT).toContain("theme: { kind: themeKind")
	})
})
