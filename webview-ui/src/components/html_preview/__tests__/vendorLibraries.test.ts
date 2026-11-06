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
	const repoRoot = join(__dirname, "..", "..", "..", "..", "..")
	const notices = readFileSync(join(repoRoot, "THIRD_PARTY_NOTICES"), "utf8")
	const lock = JSON.parse(readFileSync(join(repoRoot, "scripts", "third-party", "notices.lock.json"), "utf8")) as {
		plotlyJs: string
		noticesSha256: string
		packages: { name: string; version: string; license: string; licenseFiles: { name: string; sha256: string }[] }[]
	}
	const normalize = (text: string) => text.replace(/\r\n/g, "\n").replace(/\s+$/u, "")

	it("is the generated file: its SHA-256 matches the pin", () => {
		expect(createHash("sha256").update(notices).digest("hex")).toBe(lock.noticesSha256)
		expect(lock.plotlyJs).toBe(manifest.plotly.version)
	})

	it("has an entry, with every licence file's text, for every package in the lock", () => {
		expect(lock.packages.length).toBeGreaterThan(300)
		for (const pkg of lock.packages) {
			const heading = `${"-".repeat(80)}\n${pkg.name} ${pkg.version}\nLicense: ${pkg.license}\n${"-".repeat(80)}`
			expect(notices.includes(heading), `${pkg.name}@${pkg.version}`).toBe(true)
			if (pkg.licenseFiles.length === 0) {
				expect(notices).toContain("This package contains no LICENSE")
			}
		}
		// Each licence file's text is present verbatim: cut each package's section out (packages are written in
		// lock order) and hash the text after each "[file]" marker against the lock.
		const rule = "-".repeat(80)
		const starts = lock.packages.map((pkg) =>
			notices.indexOf(`${rule}\n${pkg.name} ${pkg.version}\nLicense: ${pkg.license}\n${rule}`),
		)
		const endOfPlotly = notices.indexOf(`\n${"=".repeat(80)}\nthree.js - three`)
		expect(endOfPlotly).toBeGreaterThan(0)
		lock.packages.forEach((pkg, index) => {
			const section = notices.slice(starts[index], index + 1 < starts.length ? starts[index + 1] : endOfPlotly)
			const markers = pkg.licenseFiles.map((file) => section.indexOf(`\n[${file.name}]\n\n`))
			pkg.licenseFiles.forEach((file, fileIndex) => {
				const from = markers[fileIndex] + `\n[${file.name}]\n\n`.length
				const to = fileIndex + 1 < markers.length ? markers[fileIndex + 1] : section.length
				expect(markers[fileIndex], `${pkg.name} ${file.name}`).toBeGreaterThan(-1)
				expect(
					createHash("sha256")
						.update(normalize(section.slice(from, to)))
						.digest("hex"),
					`${pkg.name} ${file.name}`,
				).toBe(file.sha256)
			})
		})
	})

	it("covers the packages Plotly is known to bundle (d3, turf, regl, stackgl, maplibre)", () => {
		const names = new Set(lock.packages.map((pkg) => pkg.name))
		for (const name of [
			"plotly.js",
			"@plotly/d3",
			"d3-array",
			"@turf/area",
			"@plotly/regl",
			"gl-plot3d",
			"maplibre-gl",
			"buffer",
		]) {
			expect(names.has(name), name).toBe(true)
		}
		// Build tooling that plotly.js merely lists as a dependency is not bundled and must not be claimed.
		expect(names.has("webpack")).toBe(false)
		expect(names.has("css-loader")).toBe(false)
	})

	it("names the vendored files and matches the manifest and the installed vendored packages", () => {
		for (const [id, entry] of Object.entries(manifest)) {
			const root = dirname(require.resolve(`${entry.package}/package.json`))
			const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string; license: string }
			expect(pkg.version, id).toBe(entry.version)
			expect(pkg.license, id).toBe(entry.license)
			expect(notices, id).toContain(`${entry.package} ${entry.version}`)
			expect(notices, id).toContain(entry.file.split("/").pop() as string)
		}
		expect(notices).toContain(
			normalize(readFileSync(join(dirname(require.resolve("three/package.json")), "LICENSE"), "utf8")),
		)
		expect(notices).toContain("three declares no")
	})

	it("ships Plotly's own bundle notices verbatim, pinned by hash", () => {
		const recorded = manifest.plotly.bundledNotices
		const shipped = readFileSync(join(__dirname, "..", "..", "..", "..", "public", "assets", "plotly.min.js.LICENSE.txt"))
		expect(createHash("sha256").update(shipped).digest("hex")).toBe(recorded.sha256)
		expect(notices).toContain(recorded.sha256)
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
