import { useEffect, useState } from "react"
import { type BaseMapTheme, mapThemeFromBodyClasses } from "./basemaps"

/**
 * The VS Code colour theme as the map sees it ("light" or "dark"; high-contrast themes count as dark), read
 * from the body classes VS Code sets and kept current when the user switches theme.
 */
export function useMapTheme(): BaseMapTheme {
	const read = () => (typeof document === "undefined" ? "dark" : mapThemeFromBodyClasses(document.body.classList))
	const [theme, setTheme] = useState<BaseMapTheme>(read)
	useEffect(() => {
		const observer = new MutationObserver(() => setTheme(read()))
		observer.observe(document.body, { attributes: true, attributeFilter: ["class"] })
		setTheme(read())
		return () => observer.disconnect()
	}, [])
	return theme
}
