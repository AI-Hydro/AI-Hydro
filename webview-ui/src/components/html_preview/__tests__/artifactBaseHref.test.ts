import { describe, expect, it } from "vitest"
import { applyArtifactBaseHref, buildBaseTag, FRAGMENT_NAV_GUARD_SCRIPT, normalizeDirHref } from "../artifactBaseHref"

const DIR = "https://file.vscode-cdn.net/path/_build/aihydro/labs"

describe("normalizeDirHref", () => {
	it("always ends in exactly one slash", () => {
		expect(normalizeDirHref(DIR)).to.equal(`${DIR}/`)
		expect(normalizeDirHref(`${DIR}/`)).to.equal(`${DIR}/`)
		expect(normalizeDirHref(`${DIR}///`)).to.equal(`${DIR}/`)
	})

	it("resolves single- and double-parent relative paths against the normalized base", () => {
		// The trailing slash is what keeps `../` from dropping the labs/ segment.
		const base = normalizeDirHref(DIR)
		expect(new URL("../site_libs/bootstrap.css", base).href).to.equal(
			"https://file.vscode-cdn.net/path/_build/aihydro/site_libs/bootstrap.css",
		)
		expect(new URL("../../shared/x.js", base).href).to.equal("https://file.vscode-cdn.net/path/_build/shared/x.js")
		// Counter-example documenting the bug the normalization prevents:
		expect(new URL("../site_libs/bootstrap.css", DIR).href).to.equal(
			"https://file.vscode-cdn.net/path/_build/site_libs/bootstrap.css",
		)
	})
})

describe("buildBaseTag", () => {
	it("emits a trailing-slash href", () => {
		expect(buildBaseTag(DIR)).to.equal(`<base href="${DIR}/">`)
	})

	it("escapes ampersands and quotes in the href", () => {
		expect(buildBaseTag('https://h/a&b"c')).to.equal('<base href="https://h/a&amp;b&quot;c/">')
	})
})

describe("applyArtifactBaseHref", () => {
	it("injects the base immediately after the <head> open tag, before any <link>", () => {
		const html = '<html><head><link rel="stylesheet" href="../site_libs/x.css"></head><body></body></html>'
		const out = applyArtifactBaseHref(html, DIR)
		expect(out.indexOf(`<base href="${DIR}/">`)).to.be.greaterThan(-1)
		expect(out.indexOf("<base")).to.be.lessThan(out.indexOf("<link"))
	})

	it("preserves an authored <base> and injects nothing", () => {
		const html = '<html><head><base href="https://example.org/authored/"></head><body></body></html>'
		const out = applyArtifactBaseHref(html, DIR)
		expect(out).to.equal(html)
		expect(out.match(/<base\b/giu)).to.have.length(1)
	})

	it("still injects when base-href-shaped TEXT appears in the body, not just the head", () => {
		// Regression: a real Quarto/tutorial page can contain prose or a code
		// sample mentioning `<base href>` outside <head> (e.g. explaining the
		// mechanism itself). A whole-document regex scan would mistake that
		// text for an authored tag and silently suppress injection.
		const html =
			"<html><head><title>t</title></head><body>" +
			"<!-- docs: injects a <base href> element into the page --></body></html>"
		const out = applyArtifactBaseHref(html, DIR)
		expect(out).to.contain(`<base href="${DIR}/">`)
		expect(out.indexOf("<base")).to.be.lessThan(out.indexOf("<title>"))
	})

	it("is a no-op without a directory URI", () => {
		const html = "<html><head></head><body></body></html>"
		expect(applyArtifactBaseHref(html)).to.equal(html)
		expect(applyArtifactBaseHref(html, "")).to.equal(html)
	})

	it("synthesizes a head after <html> when the document has none", () => {
		const out = applyArtifactBaseHref("<html><body>x</body></html>", DIR)
		expect(out).to.contain(`<html><head><base href="${DIR}/"></head>`)
	})

	it("prepends a head for fragment documents", () => {
		const out = applyArtifactBaseHref("<p>fragment</p>", DIR)
		expect(out.startsWith(`<head><base href="${DIR}/"></head>`)).to.equal(true)
	})
})

describe("FRAGMENT_NAV_GUARD_SCRIPT", () => {
	it("is a capture-phase, base-gated document listener", () => {
		expect(FRAGMENT_NAV_GUARD_SCRIPT).to.contain("document.addEventListener")
		expect(FRAGMENT_NAV_GUARD_SCRIPT).to.contain("true,")
		expect(FRAGMENT_NAV_GUARD_SCRIPT).to.contain('document.querySelector("base")')
		expect(FRAGMENT_NAV_GUARD_SCRIPT).to.contain("preventDefault")
		expect(FRAGMENT_NAV_GUARD_SCRIPT).to.contain("scrollIntoView")
	})
})
