import { expect } from "chai"
import { describe, it } from "mocha"
import * as path from "node:path"
import {
	assertTrustedMarketplaceRedirect,
	assertTrustedMarketplaceUrl,
	resolveContainedInstallDir,
	sanitizeMarketplaceId,
} from "../marketplaceUrlAllowlist"

describe("assertTrustedMarketplaceUrl", () => {
	it("accepts a URL on the configured modules marketplace origin", () => {
		expect(() =>
			assertTrustedMarketplaceUrl("https://ai-hydro.github.io/Modules/api/some-module/module.html", "test"),
		).to.not.throw()
	})

	it("accepts a URL on the configured research gallery origin", () => {
		expect(() => assertTrustedMarketplaceUrl("https://ai-hydro.github.io/Gallery/api/x.json", "test")).to.not.throw()
	})

	it("rejects a URL on an unrelated origin (audit finding E-2)", () => {
		expect(() => assertTrustedMarketplaceUrl("https://evil.example.com/module.html", "test")).to.throw(/allowlist/)
	})

	it("rejects a lookalike host (typosquat / subdomain trick)", () => {
		expect(() => assertTrustedMarketplaceUrl("https://ai-hydro.github.io.evil.com/x", "test")).to.throw(/allowlist/)
	})

	it("rejects malformed URLs instead of throwing an unrelated parse error", () => {
		expect(() => assertTrustedMarketplaceUrl("not-a-url", "test")).to.throw(/not a valid URL/)
	})

	it("rejects a non-http(s) scheme (e.g. file://) even on the right host string", () => {
		expect(() => assertTrustedMarketplaceUrl("file:///etc/passwd", "test")).to.throw()
	})
})

describe("marketplace transport", () => {
	it("requires https, even on the allowlisted host", () => {
		expect(() => assertTrustedMarketplaceUrl("http://ai-hydro.github.io/Modules/api/m/module.html", "test")).to.throw(
			/https is required/,
		)
	})

	it("rejects a redirect that leaves the allowlist or downgrades to http", () => {
		expect(() => assertTrustedMarketplaceRedirect({ href: "https://evil.example.com/m.html" }, "test")).to.throw(/allowlist/)
		expect(() => assertTrustedMarketplaceRedirect({ href: "http://ai-hydro.github.io/Modules/api/m.html" }, "test")).to.throw(
			/https is required/,
		)
	})

	it("allows a redirect that stays on an allowlisted https origin", () => {
		expect(() =>
			assertTrustedMarketplaceRedirect({ href: "https://ai-hydro.github.io/Modules/api/m/module.html" }, "test"),
		).to.not.throw()
	})

	it("builds the redirect URL from parts when href is absent", () => {
		expect(() =>
			assertTrustedMarketplaceRedirect(
				{ protocol: "https:", hostname: "ai-hydro.github.io", path: "/Modules/api/x" },
				"test",
			),
		).to.not.throw()
		expect(() =>
			assertTrustedMarketplaceRedirect({ protocol: "https:", hostname: "evil.example.com", path: "/x" }, "test"),
		).to.throw(/allowlist/)
	})
})

describe("marketplace id sanitisation", () => {
	it("accepts plain module ids", () => {
		for (const id of ["swat-intro", "unit_hydrograph.v2", "A1"]) {
			expect(sanitizeMarketplaceId(id, "t")).to.equal(id)
		}
	})

	it("rejects traversal, separators, absolute paths and drive letters", () => {
		for (const id of [
			"..",
			"../x",
			"a/../b",
			"a/b",
			"a\\b",
			"/etc/passwd",
			"\\\\server\\share",
			"C:\\Windows",
			"C:",
			".hidden",
			"",
			" ",
			"a\0b",
			"x..y",
			"a".repeat(129),
		]) {
			expect(() => sanitizeMarketplaceId(id, "t"), JSON.stringify(id)).to.throw(/invalid id/)
		}
	})

	it("rejects non-string ids", () => {
		expect(() => sanitizeMarketplaceId(undefined, "t")).to.throw(/invalid id/)
		expect(() => sanitizeMarketplaceId({ toString: () => "ok" }, "t")).to.throw(/invalid id/)
	})

	it("resolves an id to a directory strictly inside the install root", () => {
		const root = path.join(path.sep, "home", "u", ".aihydro", "modules")
		expect(resolveContainedInstallDir(root, "m1", "t")).to.equal(path.join(root, "m1"))
		expect(() => resolveContainedInstallDir(root, "../escape", "t")).to.throw(/invalid id/)
		expect(() => resolveContainedInstallDir(root, path.resolve("/abs"), "t")).to.throw(/invalid id/)
	})
})
