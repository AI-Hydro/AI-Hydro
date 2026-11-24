/**
 * Lesson theme signal and tokens for the Studio HTML preview.
 *
 * Lessons render in a sandboxed `<iframe srcdoc>`, a separate document. The
 * webview's `--vscode-*` variables and `vscode-light`/`vscode-dark` body
 * classes do not cross that boundary, so the host tells the document which
 * theme kind is active. Contract (also written to
 * docs/vision-2040/findings/theme-contract-2026-11-24.md):
 *
 *   - `<html data-aihydro-theme="light|dark|hc-dark|hc-light">`, set by a
 *     script injected right after `<head>` (static documents, trusted
 *     documents and installed packs alike; the installed-pack CSP allows
 *     inline scripts).
 *   - live updates arrive as `{ type: "aihydro-theme", kind }` postMessages
 *     from the parent; the document dispatches `aihydro-theme-change`.
 *   - the `--hy-*` token set below is exposed as zero-specificity fallbacks.
 *
 * Tokens come from docs/vision-2040/findings/module-theme-study-2026-11-24.md
 * section 3.3. They are checked by `themeSignal.test.ts` (WCAG contrast and
 * colour-vision-deficiency separation).
 */

export const THEME_KINDS = ["light", "dark", "hc-dark", "hc-light"] as const
export type ThemeKind = (typeof THEME_KINDS)[number]

/** Host -> document message announcing the active kind. */
export const THEME_MESSAGE_TYPE = "aihydro-theme"
/** Document -> host message asking for the current kind (late-loading documents). */
export const THEME_REQUEST_TYPE = "aihydro-theme-request"
/** DOM event dispatched on `document` after every change. */
export const THEME_CHANGE_EVENT = "aihydro-theme-change"

export function isThemeKind(value: unknown): value is ThemeKind {
	return typeof value === "string" && (THEME_KINDS as readonly string[]).includes(value)
}

/**
 * VS Code body classes -> theme kind. High-contrast classes take precedence
 * over `vscode-light`/`vscode-dark` (VS Code sets both on some builds).
 */
export function themeKindFromBodyClasses(classNames: string | DOMTokenList | undefined | null): ThemeKind {
	const classes = typeof classNames === "string" ? classNames.split(/\s+/) : Array.from(classNames ?? [])
	if (classes.includes("vscode-high-contrast-light")) {
		return "hc-light"
	}
	if (classes.includes("vscode-high-contrast")) {
		return "hc-dark"
	}
	return classes.includes("vscode-light") ? "light" : "dark"
}

export function isLightKind(kind: ThemeKind): boolean {
	return kind === "light" || kind === "hc-light"
}

export const THEME_TOKEN_NAMES = [
	"--hy-bg",
	"--hy-surface",
	"--hy-fg",
	"--hy-fg-muted",
	"--hy-link",
	"--hy-accent",
	"--hy-border",
	"--hy-axis",
	"--hy-ok",
	"--hy-warn",
	"--hy-err",
	"--hy-stage",
	"--hy-outline",
	"--hy-series-1",
	"--hy-series-2",
	"--hy-series-3",
	"--hy-series-4",
	"--hy-series-5",
] as const
export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number]

export const THEME_TOKENS: Record<ThemeKind, Record<ThemeTokenName, string>> = {
	light: {
		"--hy-bg": "#ffffff",
		"--hy-surface": "#f3f6f9",
		"--hy-fg": "#1b2430",
		"--hy-fg-muted": "#4a5868",
		"--hy-link": "#005a9e",
		"--hy-accent": "#00668a",
		"--hy-border": "#d0d7de",
		"--hy-axis": "#57606a",
		"--hy-ok": "#1a7f37",
		"--hy-warn": "#8a5300",
		"--hy-err": "#c62828",
		"--hy-stage": "#eef1f4",
		"--hy-outline": "#1b2430",
		"--hy-series-1": "#0072b2",
		"--hy-series-2": "#c25400",
		"--hy-series-3": "#007a5a",
		"--hy-series-4": "#a8507f",
		"--hy-series-5": "#1b2430",
	},
	dark: {
		"--hy-bg": "#0d1117",
		"--hy-surface": "#161b22",
		"--hy-fg": "#e6edf3",
		"--hy-fg-muted": "#9aa7b4",
		"--hy-link": "#6cb6ff",
		"--hy-accent": "#3fd0f0",
		"--hy-border": "#30363d",
		"--hy-axis": "#8b949e",
		"--hy-ok": "#56d364",
		"--hy-warn": "#e3b341",
		"--hy-err": "#ff7b72",
		"--hy-stage": "#0e1621",
		"--hy-outline": "#ffffff",
		"--hy-series-1": "#56b4e9",
		"--hy-series-2": "#e69f00",
		"--hy-series-3": "#2fbf8f",
		"--hy-series-4": "#cc79a7",
		"--hy-series-5": "#e6edf3",
	},
	// High-contrast values were proposals in the study; they are measured by themeSignal.test.ts.
	// Series colours are not CVD-separable on their own here: lessons must add dash patterns.
	"hc-dark": {
		"--hy-bg": "#000000",
		"--hy-surface": "#000000",
		"--hy-fg": "#ffffff",
		"--hy-fg-muted": "#ffffff",
		"--hy-link": "#ffff00",
		"--hy-accent": "#00ffff",
		"--hy-border": "#ffffff",
		"--hy-axis": "#ffffff",
		"--hy-ok": "#4dff4d",
		"--hy-warn": "#ffd700",
		"--hy-err": "#ff6b6b",
		"--hy-stage": "#000000",
		"--hy-outline": "#ffffff",
		"--hy-series-1": "#ffffff",
		"--hy-series-2": "#ffd700",
		"--hy-series-3": "#00ffff",
		"--hy-series-4": "#ff8c00",
		"--hy-series-5": "#ff7bff",
	},
	"hc-light": {
		"--hy-bg": "#ffffff",
		"--hy-surface": "#ffffff",
		"--hy-fg": "#000000",
		"--hy-fg-muted": "#000000",
		"--hy-link": "#0000c0",
		"--hy-accent": "#0000c0",
		"--hy-border": "#000000",
		"--hy-axis": "#000000",
		"--hy-ok": "#005a00",
		"--hy-warn": "#6b3d00",
		"--hy-err": "#a00000",
		"--hy-stage": "#ffffff",
		"--hy-outline": "#000000",
		"--hy-series-1": "#0072b2",
		"--hy-series-2": "#c25400",
		"--hy-series-3": "#007a5a",
		"--hy-series-4": "#a8507f",
		"--hy-series-5": "#000000",
	},
}

function tokenBlock(kind: ThemeKind): string {
	const t = THEME_TOKENS[kind]
	return THEME_TOKEN_NAMES.map((name) => `${name}: ${t[name]};`).join(" ")
}

/**
 * CSS custom properties for every kind. Every selector is wrapped in `:where()`
 * so it has zero specificity: a lesson's own `:root { --hy-* }` always wins and
 * these values are only fallbacks. Without the host attribute (document opened
 * outside Studio) the light set applies, switching to dark under
 * `prefers-color-scheme: dark`.
 */
export function buildThemeTokenCss(): string {
	return [
		`:where(:root:not([data-aihydro-theme])) { color-scheme: light; ${tokenBlock("light")} }`,
		`@media (prefers-color-scheme: dark) { :where(:root:not([data-aihydro-theme])) { color-scheme: dark; ${tokenBlock("dark")} } }`,
		...THEME_KINDS.map(
			(kind) =>
				`:where(:root[data-aihydro-theme="${kind}"]) { color-scheme: ${isLightKind(kind) ? "light" : "dark"}; ${tokenBlock(kind)} }`,
		),
	].join("\n")
}

/**
 * Inline script injected right after `<head>` of every srcdoc lesson. No
 * network, no eval: allowed by the installed-pack CSP (`script-src
 * 'unsafe-inline'`). `initialKind` is the kind at injection time; later
 * changes arrive by postMessage from the parent frame only.
 */
export function buildThemeScript(initialKind: ThemeKind): string {
	const kinds = JSON.stringify(THEME_KINDS)
	return `<script>(function(){
  var KINDS = ${kinds};
  var root = document.documentElement;
  function apply(kind) {
    if (KINDS.indexOf(kind) < 0) return;
    root.setAttribute('data-aihydro-theme', kind);
    root.style.colorScheme = (kind === 'light' || kind === 'hc-light') ? 'light' : 'dark';
    window.__aihydroThemeKind = kind;
    try { document.dispatchEvent(new CustomEvent('${THEME_CHANGE_EVENT}', { detail: { kind: kind } })); } catch (_) {}
  }
  apply(${JSON.stringify(initialKind)});
  window.addEventListener('message', function(e) {
    if (e.source !== window.parent || !e.data || e.data.type !== '${THEME_MESSAGE_TYPE}') return;
    apply(e.data.kind);
  });
  try { window.parent.postMessage({ type: '${THEME_REQUEST_TYPE}' }, '*'); } catch (_) {}
})();</script>`
}

/**
 * Palettes the bridge falls back to when it cannot read computed `--hy-*`
 * values (kind -> series colours, plus the few tokens charts need).
 */
export function bridgePaletteJson(): string {
	const out: Record<string, Record<string, string>> = {}
	for (const kind of THEME_KINDS) {
		out[kind] = { ...THEME_TOKENS[kind] }
	}
	return JSON.stringify(out)
}
