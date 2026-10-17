import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
	APPROVED_TOKEN,
	EVIDENCE_STATE_IDS,
	EVIDENCE_STATES,
	LINE_DASH,
	stateForInformationClass,
	TOKEN_ALLOWLIST,
	tokenVariable,
} from "../evidenceStates"

const CODICON_CSS = [
	resolve(__dirname, "../../../../node_modules/@vscode/codicons/dist/codicon.css"),
	resolve(__dirname, "../../../node_modules/@vscode/codicons/dist/codicon.css"),
].find((p) => existsSync(p)) as string

const GREEN = /(iconPassed|charts-green|terminal-ansiGreen|ansiBrightGreen|#[0-9a-f]*(?:388a34|73c991|89d185|0dbc79))/i

describe("evidenceStates", () => {
	it("covers the planned states", () => {
		expect([...EVIDENCE_STATE_IDS].sort()).toEqual(
			[
				"agent-asserted",
				"approved",
				"derived",
				"integrity-only",
				"modelled",
				"observed",
				"provisional",
				"refused",
				"stale",
				"unverified",
				"verified",
			].sort(),
		)
	})

	it("lets only `approved` reach the success token, via a per-state allowlist", () => {
		expect(EVIDENCE_STATES.approved.token).toBe(APPROVED_TOKEN)
		expect(tokenVariable(APPROVED_TOKEN)).toBe("--vscode-testing-iconPassed")
		const successVars = new Set(["--vscode-testing-iconPassed"])
		for (const id of EVIDENCE_STATE_IDS) {
			const variable = tokenVariable(EVIDENCE_STATES[id].token)
			expect(variable, `${id} token must be a theme variable`).toBeDefined()
			expect(TOKEN_ALLOWLIST[id], `${id} allowlist`).toContain(variable)
			if (id !== "approved") {
				expect(successVars.has(variable as string), `${id} must not use a success token`).toBe(false)
				for (const allowed of TOKEN_ALLOWLIST[id]) {
					expect(allowed, `${id} allowlist entry`).not.toMatch(GREEN)
					expect(allowed, `${id} allowlist entry`).not.toMatch(
						/(Added|added|Passed|Success|success|Green|green|Insert)/,
					)
				}
			}
		}
	})

	it("rejects a non-allowlisted token (mutation guard)", () => {
		// A state pointing at a green-ish variable the denylist never knew about must fail the allowlist.
		const mutated = "var(--vscode-gitDecoration-addedResourceForeground, #81b88b)"
		expect(TOKEN_ALLOWLIST.stale).not.toContain(tokenVariable(mutated))
	})

	it("gives every state a text label and an icon shape, never colour alone", () => {
		const codicons = readFileSync(CODICON_CSS, "utf8")
		const labels = new Set<string>()
		const icons = new Set<string>()
		for (const id of EVIDENCE_STATE_IDS) {
			const s = EVIDENCE_STATES[id]
			expect(s.id).toBe(id)
			expect(s.label.trim().length, `${id} label`).toBeGreaterThan(2)
			expect(s.icon, `${id} icon`).toMatch(/^codicon-[a-z-]+$/)
			expect(codicons, `${id} icon exists in codicon.css`).toContain(`.${s.icon}:before`)
			expect(s.shape).toBeTruthy()
			expect(s.description.length).toBeGreaterThan(10)
			labels.add(s.label)
			icons.add(s.icon)
		}
		expect(labels.size).toBe(EVIDENCE_STATE_IDS.length)
		expect(icons.size, "icons are distinct so states differ by shape, not hue").toBe(EVIDENCE_STATE_IDS.length)
	})

	it("distinguishes observed from modelled by line style and shape, not only hue", () => {
		expect(EVIDENCE_STATES.observed.lineStyle).toBe("solid")
		expect(EVIDENCE_STATES.modelled.lineStyle).toBe("dashed")
		expect(LINE_DASH[EVIDENCE_STATES.observed.lineStyle]).not.toBe(LINE_DASH[EVIDENCE_STATES.modelled.lineStyle])
		expect(EVIDENCE_STATES.observed.shape).not.toBe(EVIDENCE_STATES.modelled.shape)
		expect(EVIDENCE_STATES.observed.token).not.toBe(EVIDENCE_STATES.modelled.token)
	})

	it("gives every state a unique (shape, lineStyle) pair", () => {
		const pairs = EVIDENCE_STATE_IDS.map((id) => `${EVIDENCE_STATES[id].shape}/${EVIDENCE_STATES[id].lineStyle}`)
		expect(new Set(pairs).size).toBe(pairs.length)
	})

	it("maps only explicit information classes and never infers one", () => {
		expect(stateForInformationClass("observed")).toBe("observed")
		expect(stateForInformationClass("Reanalysis")).toBe("modelled")
		expect(stateForInformationClass("derived")).toBe("derived")
		expect(stateForInformationClass(undefined)).toBeUndefined()
		expect(stateForInformationClass("")).toBeUndefined()
		expect(stateForInformationClass("gauge_point")).toBeUndefined()
	})
})

describe("tokens.css", () => {
	const css = readFileSync(resolve(__dirname, "../tokens.css"), "utf8")

	it("uses hex colours only as var() fallbacks", () => {
		const withoutFallbacks = css.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, "")
		expect(withoutFallbacks).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
	})

	it("keeps the caption at 11px or more at the default 13px size", () => {
		expect(css).toMatch(/--aih-text-caption:\s*max\(11px,/)
	})

	it("zeroes motion tokens under prefers-reduced-motion", () => {
		const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"))
		for (const name of ["fast", "base", "slow"]) expect(block).toContain(`--aih-motion-${name}: 0ms`)
	})

	it("adapts borders for both high-contrast body classes", () => {
		expect(css).toContain(".vscode-high-contrast")
		expect(css).toContain(".vscode-high-contrast-light")
		expect(css).toContain("--vscode-contrastBorder")
		expect(css).toContain("--vscode-contrastActiveBorder")
	})

	it("sets no element or class rules outside the high-contrast scope (no visual change when imported)", () => {
		const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((m) => m[2].trim())
		for (const sel of selectors)
			expect([":root", ".vscode-high-contrast,\n.vscode-high-contrast-light"]).toContain(
				sel.replace(/\s+/g, " ").replace(", ", ",\n"),
			)
	})
})
