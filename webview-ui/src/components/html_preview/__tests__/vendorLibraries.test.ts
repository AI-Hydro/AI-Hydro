import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { CELL_BRIDGE_SCRIPT } from "../aihydroCellBridge"
import { buildInstalledPackCsp } from "../installedPackCsp"
import { isVendorLibraryId, loadVendorLibrarySource, resetVendorLibraryCache } from "../vendorLibraries"
import manifest from "../vendorManifest.json"

const require = createRequire(import.meta.url)

function packageFile(entry: { package: string; file: string }): Buffer {
	const root = dirname(require.resolve(`${entry.package}/package.json`))
	return readFileSync(join(root, entry.file))
}

/** A standalone ArrayBuffer copy of the bytes (Buffer.buffer may be a shared pool). */
function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
	const copy = new ArrayBuffer(bytes.byteLength)
	new Uint8Array(copy).set(bytes)
	return copy
}

describe("vendored chart libraries", () => {
	beforeEach(() => resetVendorLibraryCache())

	it("pins every entry to the digest of the installed npm package file", () => {
		for (const [id, entry] of Object.entries(manifest)) {
			const bytes = packageFile(entry)
			expect(createHash("sha256").update(bytes).digest("hex"), id).toBe(entry.sha256)
		}
	})

	it("accepts only ids from the fixed list", () => {
		expect(isVendorLibraryId("plotly")).toBe(true)
		expect(isVendorLibraryId("three")).toBe(true)
		expect(isVendorLibraryId("three-orbit")).toBe(true)
		for (const value of ["", "https://cdn.plot.ly/plotly.js", "../plotly", "__proto__", "toString", undefined, 7]) {
			expect(isVendorLibraryId(value)).toBe(false)
		}
	})

	it("returns the source when the bytes match the manifest", async () => {
		const bytes = packageFile(manifest.three)
		const source = await loadVendorLibrarySource("three", async () => arrayBufferOf(bytes))
		expect(source.length).toBeGreaterThan(1000)
	})

	it("never returns a file whose digest differs, and does not cache the failure", async () => {
		const tampered = arrayBufferOf(new TextEncoder().encode("window.stolen = true"))
		await expect(loadVendorLibrarySource("plotly", async () => tampered)).rejects.toThrow(/integrity/)
		const real = packageFile(manifest.plotly)
		await expect(loadVendorLibrarySource("plotly", async () => arrayBufferOf(real))).resolves.toContain("Plotly")
	})
})

describe("vendored library notices", () => {
	const notices = readFileSync(join(__dirname, "..", "..", "..", "..", "..", "THIRD_PARTY_NOTICES"), "utf8")

	it("carries the full licence text and version of every vendored package, matching the manifest", () => {
		for (const [id, entry] of Object.entries(manifest)) {
			const root = dirname(require.resolve(`${entry.package}/package.json`))
			const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string; license: string }
			expect(pkg.version, id).toBe(entry.version)
			expect(pkg.license, id).toBe(entry.license)
			expect(notices, id).toContain(`${entry.package} ${entry.version}`)
			expect(notices, id).toContain(`license: ${entry.license}`)
			expect(notices, id).toContain(readFileSync(join(root, "LICENSE"), "utf8").trim())
			expect(notices, id).toContain(entry.file.split("/").pop() as string)
		}
	})

	it("ships the bundled-dependency notices verbatim and names them in THIRD_PARTY_NOTICES", () => {
		const recorded = manifest.plotly.bundledNotices
		const shipped = readFileSync(join(__dirname, "..", "..", "..", "..", "public", "assets", "plotly.min.js.LICENSE.txt"))
		const upstream = readFileSync(join(dirname(require.resolve(`${recorded.package}/package.json`)), recorded.file))
		expect(createHash("sha256").update(shipped).digest("hex")).toBe(recorded.sha256)
		expect(Buffer.compare(shipped, upstream)).toBe(0)
		expect(notices).toContain(`${recorded.package} 2.35.2 npm package`)
		expect(notices).toContain(recorded.file)
		expect(recorded.version).toBe(manifest.plotly.version)
	})
})

describe("chart helpers under the installed-pack CSP", () => {
	it("keeps script-src inline-only: vendoring must not add a script origin", () => {
		const csp = buildInstalledPackCsp("https://file+.vscode-resource.vscode-cdn.net/pack/")
		const scriptSrc = csp.split("; ").find((directive) => directive.startsWith("script-src"))
		expect(scriptSrc).toBe("script-src 'unsafe-inline'")
		expect(csp).toContain("connect-src 'none'")
	})

	it("asks the host for the libraries and keeps the CDN only as a standalone fallback", () => {
		expect(CELL_BRIDGE_SCRIPT).toContain('type: "artifact/vendorLibrary"')
		expect(CELL_BRIDGE_SCRIPT).toContain('loadVendorLibrary("plotly"')
		expect(CELL_BRIDGE_SCRIPT).toContain('loadVendorLibrary("three"')
		expect(CELL_BRIDGE_SCRIPT).toContain("if (isStandalone)")
	})
})
