#!/usr/bin/env node
/**
 * Generate THIRD_PARTY_NOTICES and scripts/third-party/notices.lock.json for the chart libraries
 * vendored into the Studio webview (webview-ui/src/components/html_preview/vendorManifest.json).
 *
 *   node scripts/third-party/generate-third-party-notices.mjs            # regenerate both files
 *   node scripts/third-party/generate-third-party-notices.mjs --check    # fail if either would change
 *
 * Which packages are listed. plotly.min.js is a webpack bundle of plotly.js. This script installs the
 * exact plotly.js version from the committed lockfile (scripts/third-party/plotly-<version>.package-lock.json,
 * integrity-checked by `npm ci`) into a scratch directory, then walks the require() graph from plotly.js's
 * entry (package.json "main") and records every package a reached file resolves into. As a conservative
 * widening, the production `dependencies` of each reached package are included transitively. Packages that
 * plotly.js lists only for building (css-loader, webpack, ...) are not reached and are not listed.
 * Specifiers that cannot be resolved from Node (for example browser-field aliases) are recorded in the lock
 * file under `unresolved` rather than dropped silently.
 *
 * Every listed package gets its name, version, declared licence, and the verbatim text of each LICENSE,
 * LICENCE, COPYING or NOTICE file in its package root. A package that ships no such file is listed with
 * its declared licence and an explicit statement that the package contains no licence file.
 *
 * three.js (three.min.js, OrbitControls.js) bundles no third-party package; the script verifies that
 * three declares no dependencies.
 *
 * Output is deterministic: sorted, LF line endings, no timestamps. The SHA-256 of THIRD_PARTY_NOTICES is
 * pinned in notices.lock.json and checked by webview-ui tests.
 */
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { builtinModules, createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const manifestPath = path.join(root, "webview-ui/src/components/html_preview/vendorManifest.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
const check = process.argv.includes("--check")
const updateLock = process.argv.includes("--update-lockfile")
const plotlyVersion = manifest.plotly.version
const lockfile = path.join(root, "scripts/third-party", `plotly-${plotlyVersion}.package-lock.json`)
const outNotices = path.join(root, "THIRD_PARTY_NOTICES")
const outLock = path.join(root, "scripts/third-party/notices.lock.json")

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")
const normalize = (text) => text.replace(/\r\n/g, "\n").replace(/\s+$/u, "")
const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-_.].*)?$/i

function run(cwd, args) {
	const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
		cwd,
		encoding: "utf8",
		shell: process.platform === "win32",
	})
	if (result.status !== 0) {
		throw new Error(`npm ${args.join(" ")} failed: ${result.stdout}${result.stderr}`)
	}
}

const scratch = realpathSync(mkdtempSync(path.join(os.tmpdir(), "aihydro-plotly-notices-")))
try {
	writeFileSync(
		path.join(scratch, "package.json"),
		JSON.stringify({
			name: "plotly-notices-scratch",
			version: "0.0.0",
			private: true,
			dependencies: { "plotly.js": plotlyVersion },
		}),
	)
	if (updateLock || !existsSync(lockfile)) {
		run(scratch, ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"])
		copyFileSync(path.join(scratch, "package-lock.json"), lockfile)
	} else {
		copyFileSync(lockfile, path.join(scratch, "package-lock.json"))
		run(scratch, ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"])
	}
	const modules = path.join(scratch, "node_modules")

	/** Package root for a file inside node_modules, e.g. .../node_modules/@scope/name/lib/x.js -> .../@scope/name */
	function packageRootOf(file) {
		const marker = `${path.sep}node_modules${path.sep}`
		const at = file.lastIndexOf(marker)
		if (at === -1) {
			return null
		}
		const parts = file.slice(at + marker.length).split(path.sep)
		const length = parts[0].startsWith("@") ? 2 : 1
		return file.slice(0, at + marker.length) + parts.slice(0, length).join(path.sep)
	}
	const readPkg = (dir) => JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"))
	const rel = (file) => path.relative(modules, file).split(path.sep).join("/")
	/** Locate a package directory by walking up node_modules from `fromDir` (ignores "exports" restrictions). */
	function findPackageDir(fromDir, name) {
		for (let dir = fromDir; ; dir = path.dirname(dir)) {
			const candidate = path.join(dir, "node_modules", name)
			if (existsSync(path.join(candidate, "package.json"))) {
				return candidate
			}
			if (path.dirname(dir) === dir) {
				return null
			}
		}
	}
	const packageNameOf = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0])

	// 1. Walk the require graph from plotly.js's entry.
	const plotlyDir = path.join(modules, "plotly.js")
	const plotlyPkg = readPkg(plotlyDir)
	if (plotlyPkg.version !== plotlyVersion) {
		throw new Error(`installed plotly.js ${plotlyPkg.version} != manifest ${plotlyVersion}`)
	}
	const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])
	const seen = new Set()
	const reachedRoots = new Set()
	const unresolved = new Set()
	const queue = [createRequire(path.join(plotlyDir, "x.js")).resolve(path.join(plotlyDir, plotlyPkg.main))]
	const REQUIRE = /(?:\brequire\s*\(\s*|\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1/g
	while (queue.length) {
		const file = queue.pop()
		if (seen.has(file)) {
			continue
		}
		seen.add(file)
		const rootDir = packageRootOf(file)
		if (rootDir) {
			reachedRoots.add(rootDir)
		}
		if (!/\.(c?js|mjs)$/.test(file)) {
			continue
		}
		const requireFrom = createRequire(file)
		const text = readFileSync(file, "utf8")
		for (const match of text.matchAll(REQUIRE)) {
			const spec = match[2]
			if (builtins.has(spec) || /^(data:|https?:)/.test(spec)) {
				continue
			}
			try {
				const resolved = requireFrom.resolve(spec)
				if (path.isAbsolute(resolved)) {
					queue.push(resolved)
				}
			} catch {
				if (!spec.startsWith(".") && /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+(\/|$)/.test(spec)) {
					// Not loadable from Node (browser alias, "exports" map, ...): still count the package as reached.
					const dir = findPackageDir(path.dirname(file), packageNameOf(spec))
					if (dir) {
						reachedRoots.add(dir)
					} else {
						unresolved.add(`${rel(file)} -> ${spec}`)
					}
				}
			}
		}
	}
	// Also consider each reached package's own package.json "browser" aliases: names only.
	// 2. Widen: production dependencies of every reached package, transitively.
	const included = new Map() // dir -> pkg
	function include(dir) {
		if (included.has(dir)) {
			return
		}
		const pkg = readPkg(dir)
		included.set(dir, pkg)
		if (pkg.name === "plotly.js") {
			// plotly.js lists build tooling (css-loader, ...) as dependencies; only what its code reaches counts.
			return
		}
		for (const dep of Object.keys(pkg.dependencies ?? {})) {
			const depDir = findPackageDir(dir, dep)
			if (depDir) {
				include(depDir)
			} else {
				unresolved.add(`${pkg.name}@${pkg.version} dependency ${dep}`)
			}
		}
	}
	for (const dir of [...reachedRoots].sort()) {
		include(dir)
	}

	// 2b. plotly.js ships stackgl_modules/index.js, a prebuilt webpack bundle of the gl-* packages listed in
	// stackgl_modules/package.json (its own lockfile pins them), with Node polyfills from
	// node-polyfill-webpack-plugin. None of it is reachable through require() from the entry, so install that
	// sub-project from its own lockfile and include its production dependencies and the polyfill plugin.
	const stackglSource = path.join(plotlyDir, "stackgl_modules")
	const stackglDir = path.join(scratch, "stackgl")
	mkdirSync(stackglDir)
	copyFileSync(path.join(stackglSource, "package.json"), path.join(stackglDir, "package.json"))
	copyFileSync(path.join(stackglSource, "package-lock.json"), path.join(stackglDir, "package-lock.json"))
	run(stackglDir, ["ci", "--ignore-scripts", "--no-audit", "--no-fund"])
	const stackglPkg = readPkg(stackglDir)
	for (const name of [...Object.keys(stackglPkg.dependencies ?? {}), "node-polyfill-webpack-plugin"].sort()) {
		const dir = findPackageDir(stackglDir, name)
		if (!dir) {
			throw new Error(`stackgl_modules dependency ${name} is not installed`)
		}
		include(dir)
	}

	// 3. Collect licence files.
	const entries = [...included.values()].map((pkg) => {
		const dir = [...included.entries()].find(([, value]) => value === pkg)[0]
		const files = readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isFile() && LICENSE_FILE.test(entry.name))
			.map((entry) => entry.name)
			.sort()
		const declared =
			typeof pkg.license === "string"
				? pkg.license
				: (pkg.license?.type ?? (pkg.licenses ? JSON.stringify(pkg.licenses) : "UNDECLARED"))
		return {
			name: pkg.name,
			version: pkg.version,
			license: declared,
			isPlotly: pkg.name === "plotly.js",
			metadata: [
				["author", typeof pkg.author === "string" ? pkg.author : pkg.author?.name],
				["repository", typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url],
				["homepage", pkg.homepage],
			].filter(([, value]) => value),
			files: files.map((name) => ({ name, text: normalize(readFileSync(path.join(dir, name), "utf8")) })),
		}
	})
	// The same name@version can be installed in several places; list it once (text-identical files only).
	const unique = new Map()
	for (const entry of entries) {
		const key = `${entry.name}@${entry.version}`
		const previous = unique.get(key)
		if (previous && JSON.stringify(previous.files) !== JSON.stringify(entry.files)) {
			throw new Error(`${key} is installed twice with different licence files`)
		}
		unique.set(key, previous ?? entry)
	}
	entries.length = 0
	entries.push(...unique.values())
	entries.sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)))

	// 4. three.js check.
	const threeEntry = manifest.three
	const threePkg = JSON.parse(readFileSync(path.join(root, "webview-ui/node_modules/three/package.json"), "utf8"))
	if (Object.keys(threePkg.dependencies ?? {}).length > 0 || threePkg.version !== threeEntry.version) {
		throw new Error("three.js declares dependencies or differs from the manifest; extend this script before shipping")
	}
	const threeLicense = normalize(readFileSync(path.join(root, "webview-ui/node_modules/three/LICENSE"), "utf8"))
	const plotlyBundleNotices = manifest.plotly.bundledNotices

	// 5. Write the notices file.
	const rule = "=".repeat(80)
	const lines = [
		"THIRD-PARTY NOTICES",
		"",
		"AI-Hydro Studio ships the following unmodified third-party files in webview-ui/build/assets/ so that",
		"installed Learning Packs can draw charts without a network request. The SHA-256 of each file is pinned",
		"in webview-ui/src/components/html_preview/vendorManifest.json and checked before use.",
		"",
		"This file is generated by scripts/third-party/generate-third-party-notices.mjs; do not edit it by hand.",
		"",
		rule,
		`Plotly.js - plotly.js-dist-min ${manifest.plotly.version} - file: plotly.min.js`,
		rule,
		"",
		"plotly.min.js is byte-identical to dist/plotly.min.js of the plotly.js npm package of the same version",
		`(SHA-256 ${manifest.plotly.sha256}). It is a webpack bundle that includes third-party packages.`,
		"Upstream's own notice file for that bundle is shipped verbatim next to it as plotly.min.js.LICENSE.txt",
		`(dist/${path.basename(plotlyBundleNotices.file)} of the plotly.js ${plotlyBundleNotices.version} package, SHA-256 ${plotlyBundleNotices.sha256}).`,
		"",
		`The packages below were found by following the require() graph from plotly.js ${manifest.plotly.version}'s entry`,
		"and adding the production dependencies of every package reached. That is a conservative superset of",
		"what is in the bundle, not a list read out of the bundle itself. Packages that contain no licence file are listed",
		"with what their package.json declares; those need a human check before a release (see notices.lock.json).",
		"Each entry gives the package, its",
		"declared licence and the verbatim text of its licence files.",
		"",
	]
	for (const entry of entries) {
		lines.push("-".repeat(80), `${entry.name} ${entry.version}`, `License: ${entry.license}`, "-".repeat(80), "")
		if (entry.files.length === 0) {
			lines.push(
				`(This package contains no LICENSE, LICENCE, COPYING or NOTICE file; its package.json declares the licence above.)`,
			)
			for (const [key, value] of entry.metadata) {
				lines.push(`${key}: ${value}`)
			}
			lines.push("")
		}
		for (const file of entry.files) {
			lines.push(`[${file.name}]`, "", file.text, "")
		}
	}
	lines.push(
		rule,
		`three.js - three ${threeEntry.version} - files: three.min.js, OrbitControls.js (examples/js/controls)`,
		rule,
		"",
		"three.min.js and OrbitControls.js are copied unmodified from the three npm package. three declares no",
		"dependencies, and these files bundle no other third-party package.",
		"",
		"[LICENSE]",
		"",
		threeLicense,
		"",
	)
	const notices = `${lines.join("\n").replace(/\s+$/u, "")}\n`

	const lock = {
		generator: "scripts/third-party/generate-third-party-notices.mjs",
		plotlyJs: plotlyVersion,
		plotlyLockfileSha256: sha256(readFileSync(lockfile)),
		noticesSha256: sha256(notices),
		packages: entries.map((entry) => ({
			name: entry.name,
			version: entry.version,
			license: entry.license,
			licenseFiles: entry.files.map((file) => ({ name: file.name, sha256: sha256(file.text) })),
		})),
		unresolved: [...unresolved].sort(),
	}
	const lockText = `${JSON.stringify(lock, null, "\t")}\n`

	if (check) {
		const same =
			existsSync(outNotices) &&
			readFileSync(outNotices, "utf8") === notices &&
			existsSync(outLock) &&
			readFileSync(outLock, "utf8") === lockText
		if (!same) {
			console.error("THIRD_PARTY_NOTICES or notices.lock.json is out of date; run the generator")
			process.exit(1)
		}
		console.log(`up to date: ${entries.length} packages`)
	} else {
		mkdirSync(path.dirname(outLock), { recursive: true })
		writeFileSync(outNotices, notices)
		writeFileSync(outLock, lockText)
		console.log(`wrote ${entries.length} packages, ${unresolved.size} unresolved, sha256 ${lock.noticesSha256}`)
	}
} finally {
	rmSync(scratch, { recursive: true, force: true })
}
