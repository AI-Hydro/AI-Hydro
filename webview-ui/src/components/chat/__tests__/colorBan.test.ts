import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * "Nothing green unless approved" (vision-2040 chat audit, layout rule 5). The only green anywhere a transcript can
 * reach comes from design/evidenceStates.ts (`approved`). This scans every surface that can render in the chat
 * transcript (chat, task header, common, browser, history, MCP chat display, the design module) plus the global
 * stylesheet. Comments are ignored. Other panels (Studio, settings, maps, boards) are separate surfaces.
 */
const SRC = join(__dirname, "../../..")
const SCANNED = [
	"components/chat",
	"components/common",
	"components/browser",
	"components/history",
	"components/mcp/chat-display",
	"design",
	"index.css",
]
/** The one file allowed to name the approved green token. */
const ALLOWED = new Set(["design/evidenceStates.ts"])

const NAMED =
	/charts-green|testing-iconPassed|gitDecoration-added|terminal-ansi(?:Bright)?Green|emerald|green|\b(?:bg|text|border|ring|fill|stroke|from|to|via)-success\b|color="success"|--ai-hydro-success/i

/** True when an sRGB colour sits in the green hue band with visible saturation. */
function isGreen(r: number, g: number, b: number): boolean {
	const [rn, gn, bn] = [r, g, b].map((v) => v / 255)
	const max = Math.max(rn, gn, bn)
	const min = Math.min(rn, gn, bn)
	const delta = max - min
	if (delta === 0 || max !== gn) {
		return false
	}
	const lightness = (max + min) / 2
	const saturation = delta / (1 - Math.abs(2 * lightness - 1))
	const hue = (60 * (((bn - rn) / delta + 2) % 6) + 360) % 360
	return hue >= 75 && hue <= 165 && saturation > 0.25 && lightness > 0.1 && lightness < 0.9
}

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
}

export function greenFindings(source: string): string[] {
	const code = stripComments(source)
	const found: string[] = []
	const named = NAMED.exec(code)
	if (named) {
		found.push(named[0])
	}
	for (const [, hex] of code.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
		if (
			isGreen(
				Number.parseInt(hex.slice(0, 2), 16),
				Number.parseInt(hex.slice(2, 4), 16),
				Number.parseInt(hex.slice(4, 6), 16),
			)
		) {
			found.push(`#${hex}`)
		}
	}
	for (const [, r, g, b] of code.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g)) {
		if (isGreen(+r, +g, +b)) {
			found.push(`rgb(${r},${g},${b})`)
		}
	}
	return found
}

function sourceFiles(path: string): string[] {
	if (!statSync(path).isDirectory()) {
		return [path]
	}
	return readdirSync(path).flatMap((name) => {
		const child = join(path, name)
		if (statSync(child).isDirectory()) {
			return name === "__tests__" ? [] : sourceFiles(child)
		}
		return /\.(tsx?|css)$/.test(name) && !/\.(test|spec|stories)\./.test(name) ? [child] : []
	})
}

describe("green is reserved for approved claims", () => {
	it("flags the patterns it is meant to catch", () => {
		expect(greenFindings('style={{ color: "var(--vscode-charts-green)" }}')).toEqual(["charts-green"])
		expect(greenFindings('className="text-success"')).toEqual(["text-success"])
		expect(greenFindings("background: #56D364;")).toEqual(["#56D364"])
		expect(greenFindings("border: 1px solid rgba(0, 200, 120, 0.5)")).toEqual(["rgb(0,200,120)"])
		expect(greenFindings("--x: var(--ai-hydro-emerald)")).toEqual(["emerald"])
		expect(greenFindings("color: var(--vscode-gitDecoration-addedResourceForeground)")).toEqual(["gitDecoration-added"])
	})

	it("ignores comments, blue/red/grey hexes and non-colour uses of 'success'", () => {
		expect(greenFindings("// nothing green here\n/* emerald */ const a = '#4A90E2'")).toEqual([])
		expect(greenFindings("if (!response.success) return; const c = '#F85149'")).toEqual([])
	})

	it("has no green anywhere a transcript can reach", () => {
		const offenders: string[] = []
		expect(SCANNED.flatMap((entry) => sourceFiles(join(SRC, entry))).length).toBeGreaterThan(50)
		for (const entry of SCANNED) {
			for (const file of sourceFiles(join(SRC, entry))) {
				const rel = relative(SRC, file).split("\\").join("/")
				if (ALLOWED.has(rel)) {
					continue
				}
				const hits = greenFindings(readFileSync(file, "utf8"))
				if (hits.length) {
					offenders.push(`${rel}: ${hits.join(", ")}`)
				}
			}
		}
		expect(offenders).toEqual([])
	})
})
