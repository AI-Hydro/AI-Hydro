import { describe, expect, it } from "vitest"
import { AIHYDRO_DESIGN_SYSTEM_FONTS, AIHYDRO_PREVIEW_STYLE, usesAihydroDesignSystem } from "../aihydroCellBridge"

describe("usesAihydroDesignSystem", () => {
	it("is true when the HTML uses the .aihydro-module class", () => {
		expect(usesAihydroDesignSystem('<body class="aihydro-module">...</body>')).to.equal(true)
	})

	it("is true when the HTML embeds a module manifest", () => {
		expect(usesAihydroDesignSystem('<script type="application/vnd.aihydro.module+json">{"id":"m"}</script>')).to.equal(true)
	})

	it("is false for a generic artifact using neither", () => {
		expect(usesAihydroDesignSystem("<html><body><h1>Report</h1></body></html>")).to.equal(false)
		expect(usesAihydroDesignSystem('<div class="folium-map"></div>')).to.equal(false)
	})
})

describe("AIHYDRO_DESIGN_SYSTEM_FONTS / AIHYDRO_PREVIEW_STYLE split", () => {
	it("keeps the network font <link> tags out of the always-injected style block", () => {
		// Regression guard for the CSS-ownership fix: the font <link>s must live
		// only in the conditionally-injected constant, not in the unconditional
		// one, or every artifact would pay for the network request again.
		expect(AIHYDRO_PREVIEW_STYLE).not.to.contain("fonts.googleapis.com")
		expect(AIHYDRO_DESIGN_SYSTEM_FONTS).to.contain("fonts.googleapis.com")
	})

	it("every .aihydro-* rule in the always-injected block is class-scoped, not a bare element selector", () => {
		// A bare `body {`, `h1 {`, `p {`, `table {`, `a {` selector would leak
		// styling onto artifacts that never opt into .aihydro-module — verified
		// absent when this test was written; this guards against regressing it.
		const bareSelectorPattern = /(?:^|\n|\})\s*(body|html|h1|h2|h3|h4|p|a|table|th|td|ul|ol|li|blockquote)\s*[,{]/
		expect(bareSelectorPattern.test(AIHYDRO_PREVIEW_STYLE)).to.equal(false)
	})
})
