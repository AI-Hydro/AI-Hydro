import { useEffect, useState } from "react"
import { type ThemeKind, themeKindFromBodyClasses } from "./themeSignal"

/**
 * The VS Code theme kind of the Studio webview, kept live. VS Code swaps the
 * `vscode-light` / `vscode-dark` / `vscode-high-contrast*` classes on `<body>`
 * when the user changes theme; a MutationObserver picks that up with no reload.
 */
export function useHostThemeKind(): ThemeKind {
	const [kind, setKind] = useState<ThemeKind>(() =>
		typeof document === "undefined" ? "dark" : themeKindFromBodyClasses(document.body?.classList),
	)
	useEffect(() => {
		if (typeof document === "undefined" || !document.body) {
			return
		}
		const read = () => setKind(themeKindFromBodyClasses(document.body.classList))
		read()
		const observer = new MutationObserver(read)
		observer.observe(document.body, { attributes: true, attributeFilter: ["class"] })
		return () => observer.disconnect()
	}, [])
	return kind
}
