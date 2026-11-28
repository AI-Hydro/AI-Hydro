/**
 * Studio shell chrome tokens (course header, course navigator, kernel chip,
 * cell toolbar).
 *
 * The chrome used a dark-only palette (`#00DDFF` title, `#4ade80` completed
 * marker, pale-green kernel "Ready"), which measures 1.6-1.9:1 on a white
 * editor. These tokens give each of the four VS Code theme kinds its own value
 * and are published as `--aihydro-chrome-*` custom properties keyed on the
 * `<body>` theme class VS Code sets, so a theme switch needs no re-render.
 *
 * Components read them through `chrome.<name>` (a `var()` whose fallback is the
 * dark value, so the dark look is unchanged and unstyled test DOMs still work).
 * Greys and foregrounds that VS Code already themes (`--vscode-foreground`,
 * `--vscode-descriptionForeground`, `--vscode-panel-border`, ...) stay
 * `--vscode-*`; these tokens cover the brand accent, status colours and tints
 * that have no VS Code equivalent.
 *
 * Lesson documents do not use this file: lessons own their body (theme
 * contract section 3). Contrast is asserted by `__tests__/chromeTheme.test.ts`.
 */

import type { ThemeKind } from "./themeSignal"

export const KERNEL_STATES = ["ready", "dirty", "busy", "starting", "error", "stopped", "idle"] as const
export type KernelTokenState = (typeof KERNEL_STATES)[number]

const BASE_NAMES = [
	"accent", // accent text and glyphs: course title, active toolbar state, progress fill end
	"accent2", // progress-fill gradient start
	"onAccent", // text on a solid accent badge
	"accentBorder",
	"accentTint",
	"accentTintStrong",
	"headerBg",
	"ok", // completed marker text and glyphs
	"ok2", // completed progress-fill gradient end
	"onOk", // text on a solid ok badge
	"okBorder",
	"okTint",
	"okTintStrong",
	"track", // progress track
	"badge", // idle numbered badge background
	"hover",
	"hoverBorder",
	"line", // hairlines and group borders
	"menuLine",
	"surface", // run-group pill background
	"activeBg",
	"activeBorder",
	"editActiveBg",
	"editActiveBorder",
	"warn", // workspace-not-trusted banner text
	"warnBg",
	"danger", // destructive button background
	"onDanger",
	"glowAccent",
	"glowOk",
] as const
export type BaseTokenName = (typeof BASE_NAMES)[number]

export type KernelTokenName = `kernel${Capitalize<KernelTokenState>}${"Dot" | "Bg" | "Border" | "Fg"}`
export type ChromeTokenName = BaseTokenName | KernelTokenName
export type ChromeTokens = Record<ChromeTokenName, string>

/** Kernel chip colours for one state: dot, tint, border, label. */
function kernel(state: KernelTokenState, dot: string, tint: string, border: string, fg: string): Record<string, string> {
	const s = state[0].toUpperCase() + state.slice(1)
	return { [`kernel${s}Dot`]: dot, [`kernel${s}Bg`]: tint, [`kernel${s}Border`]: border, [`kernel${s}Fg`]: fg }
}

const DARK_BASE: Record<BaseTokenName, string> = {
	accent: "#00DDFF",
	accent2: "#00A3FF",
	onAccent: "#0a0a15",
	accentBorder: "rgba(0,221,255,0.35)",
	accentTint: "rgba(0,221,255,0.10)",
	accentTintStrong: "rgba(0,221,255,0.25)",
	headerBg: "linear-gradient(180deg, rgba(0,221,255,0.10), rgba(0,163,255,0.04))",
	ok: "#4ade80",
	ok2: "#22c55e",
	onOk: "#0a0a15",
	okBorder: "rgba(74,222,128,0.4)",
	okTint: "rgba(74,222,128,0.06)",
	okTintStrong: "rgba(74,222,128,0.18)",
	track: "rgba(125,211,252,0.10)",
	badge: "rgba(125,211,252,0.12)",
	hover: "rgba(255,255,255,0.06)",
	hoverBorder: "rgba(255,255,255,0.22)",
	line: "rgba(255,255,255,0.12)",
	menuLine: "rgba(255,255,255,0.15)",
	surface: "rgba(255,255,255,0.03)",
	activeBg: "rgba(0,163,255,0.10)",
	activeBorder: "rgba(0,163,255,0.35)",
	editActiveBg: "linear-gradient(135deg, rgba(0,163,255,0.22), rgba(0,221,255,0.18))",
	editActiveBorder: "rgba(0,221,255,0.55)",
	warn: "#cca700",
	warnBg: "rgba(204,160,0,0.10)",
	danger: "#f48771",
	onDanger: "#1f1f1f",
	glowAccent: "0 0 8px #00DDFF",
	glowOk: "0 0 8px #4ade80",
}

const LIGHT_BASE: Record<BaseTokenName, string> = {
	accent: "#0b5cad",
	accent2: "#1a73c8",
	onAccent: "#ffffff",
	accentBorder: "rgba(11,92,173,0.55)",
	accentTint: "rgba(11,92,173,0.08)",
	accentTintStrong: "rgba(11,92,173,0.16)",
	headerBg: "linear-gradient(180deg, rgba(11,92,173,0.08), rgba(11,92,173,0.03))",
	ok: "#176d30",
	ok2: "#1f8a3b",
	onOk: "#ffffff",
	okBorder: "rgba(23,109,48,0.5)",
	okTint: "rgba(23,109,48,0.07)",
	okTintStrong: "rgba(23,109,48,0.14)",
	track: "rgba(11,92,173,0.14)",
	badge: "rgba(11,92,173,0.10)",
	hover: "rgba(0,0,0,0.06)",
	hoverBorder: "rgba(0,0,0,0.30)",
	line: "rgba(0,0,0,0.16)",
	menuLine: "rgba(0,0,0,0.20)",
	surface: "rgba(0,0,0,0.03)",
	activeBg: "rgba(11,92,173,0.10)",
	activeBorder: "rgba(11,92,173,0.45)",
	editActiveBg: "linear-gradient(135deg, rgba(11,92,173,0.16), rgba(26,115,200,0.12))",
	editActiveBorder: "rgba(11,92,173,0.6)",
	warn: "#6f5100",
	warnBg: "rgba(191,136,3,0.12)",
	danger: "#a1260d",
	onDanger: "#ffffff",
	glowAccent: "none",
	glowOk: "none",
}

const HC_DARK_BASE: Record<BaseTokenName, string> = {
	...DARK_BASE,
	accent2: "#00DDFF",
	onAccent: "#000000",
	onOk: "#000000",
	accentBorder: "#00DDFF",
	okBorder: "#4ade80",
	hover: "rgba(255,255,255,0.14)",
	hoverBorder: "#ffffff",
	line: "#ffffff",
	menuLine: "#ffffff",
	surface: "transparent",
	activeBorder: "#00DDFF",
	editActiveBorder: "#00DDFF",
	warn: "#ffd54f",
	danger: "#ff8a80",
	onDanger: "#000000",
	glowAccent: "none",
	glowOk: "none",
}

const HC_LIGHT_BASE: Record<BaseTokenName, string> = {
	...LIGHT_BASE,
	accent: "#003f8a",
	accent2: "#0b5cad",
	ok: "#0f5c24",
	ok2: "#0f5c24",
	accentBorder: "#003f8a",
	okBorder: "#0f5c24",
	hover: "rgba(0,0,0,0.12)",
	hoverBorder: "#000000",
	line: "#000000",
	menuLine: "#000000",
	surface: "transparent",
	activeBorder: "#003f8a",
	editActiveBorder: "#003f8a",
	warn: "#5c4300",
	danger: "#8f1f0a",
}

export const CHROME_TOKENS: Record<ThemeKind, ChromeTokens> = {
	dark: {
		...DARK_BASE,
		...kernel("ready", "#89d185", "rgba(137,209,133,0.10)", "rgba(137,209,133,0.30)", "#a0c8a0"),
		...kernel("dirty", "#cca700", "rgba(204,167,0,0.10)", "rgba(204,167,0,0.30)", "#c8b060"),
		...kernel("busy", "#1a7fd4", "rgba(14,112,192,0.12)", "rgba(14,112,192,0.35)", "#6ab0e0"),
		...kernel("starting", "#cca700", "rgba(204,167,0,0.10)", "rgba(204,167,0,0.30)", "#c8b060"),
		...kernel("error", "#f14c4c", "rgba(241,76,76,0.10)", "rgba(241,76,76,0.30)", "#d88080"),
		// Dark #888/#777 labels measured 4.9:1 / 3.9:1 on #1f1f1f; idle is lifted just enough to pass.
		...kernel("stopped", "#777777", "rgba(120,120,120,0.08)", "rgba(120,120,120,0.22)", "#8f8f8f"),
		...kernel("idle", "#6e6e6e", "rgba(80,80,80,0.08)", "rgba(80,80,80,0.20)", "#8a8a8a"),
	} as ChromeTokens,
	light: {
		...LIGHT_BASE,
		...kernel("ready", "#2e7d32", "rgba(46,125,50,0.10)", "rgba(46,125,50,0.40)", "#176d30"),
		...kernel("dirty", "#946b00", "rgba(148,107,0,0.10)", "rgba(148,107,0,0.40)", "#6f5100"),
		...kernel("busy", "#0e70c0", "rgba(14,112,192,0.10)", "rgba(14,112,192,0.40)", "#0b5cad"),
		...kernel("starting", "#946b00", "rgba(148,107,0,0.10)", "rgba(148,107,0,0.40)", "#6f5100"),
		...kernel("error", "#c62828", "rgba(198,40,40,0.08)", "rgba(198,40,40,0.40)", "#a1260d"),
		...kernel("stopped", "#6b6b6b", "rgba(100,100,100,0.08)", "rgba(100,100,100,0.30)", "#595959"),
		...kernel("idle", "#767676", "rgba(100,100,100,0.06)", "rgba(100,100,100,0.25)", "#5f5f5f"),
	} as ChromeTokens,
	"hc-dark": {
		...HC_DARK_BASE,
		...kernel("ready", "#89d185", "transparent", "#89d185", "#b5e8b0"),
		...kernel("dirty", "#ffd54f", "transparent", "#ffd54f", "#ffd54f"),
		...kernel("busy", "#3794ff", "transparent", "#3794ff", "#9ccfff"),
		...kernel("starting", "#ffd54f", "transparent", "#ffd54f", "#ffd54f"),
		...kernel("error", "#ff6b6b", "transparent", "#ff6b6b", "#ffb0b0"),
		...kernel("stopped", "#b0b0b0", "transparent", "#b0b0b0", "#d0d0d0"),
		...kernel("idle", "#9a9a9a", "transparent", "#9a9a9a", "#c0c0c0"),
	} as ChromeTokens,
	"hc-light": {
		...HC_LIGHT_BASE,
		...kernel("ready", "#0f5c24", "transparent", "#0f5c24", "#0f5c24"),
		...kernel("dirty", "#5c4300", "transparent", "#5c4300", "#5c4300"),
		...kernel("busy", "#003f8a", "transparent", "#003f8a", "#003f8a"),
		...kernel("starting", "#5c4300", "transparent", "#5c4300", "#5c4300"),
		...kernel("error", "#8f1f0a", "transparent", "#8f1f0a", "#8f1f0a"),
		...kernel("stopped", "#3d3d3d", "transparent", "#3d3d3d", "#3d3d3d"),
		...kernel("idle", "#4a4a4a", "transparent", "#4a4a4a", "#4a4a4a"),
	} as ChromeTokens,
}

const PREFIX = "--aihydro-chrome-"
const cssName = (name: string) => PREFIX + name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/**
 * `var(--aihydro-chrome-<name>, <dark value>)` for every token, for use in
 * inline styles. The fallback keeps the existing dark look when the stylesheet
 * is absent (unit-test DOMs, a webview that has not injected it yet).
 */
export const chrome = Object.fromEntries(
	(Object.keys(CHROME_TOKENS.dark) as ChromeTokenName[]).map((name) => [
		name,
		`var(${cssName(name)}, ${CHROME_TOKENS.dark[name]})`,
	]),
) as ChromeTokens

/** Chip colours for one kernel state, as `var()` strings. */
export function chromeKernel(state: KernelTokenState): { dot: string; bg: string; border: string; fg: string } {
	const s = state[0].toUpperCase() + state.slice(1)
	return {
		dot: chrome[`kernel${s}Dot` as KernelTokenName],
		bg: chrome[`kernel${s}Bg` as KernelTokenName],
		border: chrome[`kernel${s}Border` as KernelTokenName],
		fg: chrome[`kernel${s}Fg` as KernelTokenName],
	}
}

function block(selector: string, tokens: ChromeTokens): string {
	const decls = (Object.keys(tokens) as ChromeTokenName[]).map((n) => `${cssName(n)}:${tokens[n]};`).join("")
	return `${selector}{${decls}}`
}

/**
 * Stylesheet text. The four selectors are mutually exclusive so none depends on
 * source order: VS Code sets `vscode-high-contrast` on both HC themes and adds
 * `vscode-high-contrast-light` on the light one, mirroring
 * `themeKindFromBodyClasses`. Dark is the bare `body` default.
 */
export function buildChromeCss(): string {
	return [
		block("body", CHROME_TOKENS.dark),
		block("body.vscode-light:not(.vscode-high-contrast):not(.vscode-high-contrast-light)", CHROME_TOKENS.light),
		block("body.vscode-high-contrast:not(.vscode-high-contrast-light)", CHROME_TOKENS["hc-dark"]),
		block("body.vscode-high-contrast-light", CHROME_TOKENS["hc-light"]),
	].join("\n")
}

const STYLE_ID = "aihydro-chrome-theme-style"

/** Idempotent; call from any chrome component's render. */
export function ensureChromeThemeStyle(): void {
	if (typeof document === "undefined" || document.getElementById(STYLE_ID)) {
		return
	}
	const el = document.createElement("style")
	el.id = STYLE_ID
	el.textContent = buildChromeCss()
	document.head.appendChild(el)
}
