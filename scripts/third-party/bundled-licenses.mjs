/**
 * Licence notices for the npm packages compiled INTO the shipped bundles (dist/extension.js by esbuild,
 * webview-ui/build/assets/index.js by vite). THIRD_PARTY_NOTICES covers only the files vendored verbatim
 * (Plotly, three.js); this module covers everything a bundler copied in.
 *
 * The package set comes from the bundler's own record of what it emitted, not from a dependency walk:
 *   - esbuild: metafile.outputs[<outfile>].inputs, keeping inputs with bytesInOutput > 0
 *   - vite/rollup: chunk.modules, keeping modules with renderedLength > 0
 * so a package that was tree-shaken away is not listed and one that was bundled cannot be missed.
 *
 * For each package: name, version, declared licence, and the verbatim text of every LICENSE / LICENCE /
 * COPYING / NOTICE file in its root. A package with no such file falls back to
 * scripts/third-party/licence-overrides.json (verbatim upstream text, keyed name@version, with its source
 * URL); without an override it is listed as "needs human check". Copyleft-only licences (GPL, LGPL, AGPL,
 * MPL, EPL, CDDL, EUPL, OSL, CC-BY-SA with no permissive alternative) are problems too. Any problem not
 * recorded under "knownProblems" in licence-overrides.json fails the build.
 *
 * Output is deterministic: sorted by name then version, LF line endings, no timestamps or absolute paths.
 *
 * CLI (extension host):
 *   node scripts/third-party/bundled-licenses.mjs --esbuild-metafile dist/extension-metafile.json \
 *        --output dist/extension.js --out dist/THIRD_PARTY_LICENSES.txt
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-_.].*)?$/i
const COPYLEFT = /\b(A?GPL|LGPL|MPL|EPL|CDDL|EUPL|OSL|CC-BY-SA)\b/i
const OVERRIDES_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "licence-overrides.json")
const normalize = (text) => text.replace(/\r\n/g, "\n").replace(/\s+$/u, "")

/** Package root for a path inside node_modules (handles scopes and nesting); null for first-party code. */
export function packageRootOf(file) {
	const norm = `/${file.split(path.sep).join("/")}`
	const marker = "/node_modules/"
	const at = norm.lastIndexOf(marker)
	if (at === -1) {
		return null
	}
	const start = at + marker.length
	const parts = norm.slice(start).split("/")
	const length = parts[0].startsWith("@") ? 2 : 1
	if (parts.length <= length) {
		return null
	}
	return norm.slice(1, start) + parts.slice(0, length).join("/")
}

function declaredLicense(pkg) {
	if (typeof pkg.license === "string") return pkg.license
	if (pkg.license && typeof pkg.license.type === "string") return pkg.license.type
	if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(" OR ")
	return "UNKNOWN"
}

/**
 * Collect package records for bundled module paths.
 * @param {string[]} modulePaths absolute, or relative to `baseDir`
 * @param {string} baseDir
 */
export function collectPackages(modulePaths, baseDir, overrides = loadOverrides()) {
	const roots = new Set()
	for (const p of modulePaths) {
		const clean = p.replace(/^\0/, "").replace(/\?.*$/, "")
		const root = packageRootOf(path.isAbsolute(clean) ? clean : path.join(baseDir, clean))
		if (root) roots.add(root)
	}
	const byKey = new Map()
	for (const root of roots) {
		// A sub-path package.json (e.g. "type": "module" markers) has no name; walk up to the real root.
		const pkgFile = path.join(root, "package.json")
		if (!existsSync(pkgFile)) continue
		const pkg = JSON.parse(readFileSync(pkgFile, "utf8"))
		if (!pkg.name || !pkg.version) continue
		const key = `${pkg.name}@${pkg.version}`
		if (byKey.has(key)) continue
		const files = readdirSync(root)
			.filter((f) => LICENSE_FILE.test(f))
			.sort()
			.map((f) => ({ file: f, text: normalize(readFileSync(path.join(root, f), "utf8")) }))
		const override = files.length === 0 ? overrides[key] : undefined
		byKey.set(key, {
			name: pkg.name,
			version: pkg.version,
			license: declaredLicense(pkg),
			files,
			override: override
				? override.noUpstreamText
					? { noUpstreamText: override.noUpstreamText }
					: { source: override.source, text: normalize(override.text) }
				: undefined,
		})
	}
	return [...byKey.values()].sort((a, b) => (a.name === b.name ? (a.version < b.version ? -1 : 1) : a.name < b.name ? -1 : 1))
}

export function loadOverrides(file = OVERRIDES_PATH) {
	if (!existsSync(file)) return {}
	const raw = JSON.parse(readFileSync(file, "utf8"))
	return raw.packages ?? {}
}

/**
 * True when every alternative of an SPDX expression is copyleft. "(MIT OR GPL-3.0-or-later)" is not: the
 * distributor may elect MIT. AND-combined terms all apply, so one copyleft term makes the whole copyleft.
 */
export function onlyCopyleft(expression) {
	const alternatives = expression.replace(/[()]/g, " ").split(/\s+OR\s+/i)
	return alternatives.every((alt) => alt.split(/\s+AND\s+/i).some((term) => COPYLEFT.test(term)))
}

/**
 * Problems not yet listed in licence-overrides.json "knownProblems" (each with the decision that keeps it
 * open). A build fails on these only, so a newly bundled package cannot slip in unreviewed.
 */
export function unexpectedProblems(problems, known = loadKnownProblems()) {
	const accepted = new Set(known.map((k) => k.problem))
	return problems.filter((p) => !accepted.has(p))
}

export function loadKnownProblems(file = OVERRIDES_PATH) {
	if (!existsSync(file)) return []
	return JSON.parse(readFileSync(file, "utf8")).knownProblems ?? []
}

/** Generate the notices for an esbuild output and fail on unexpected problems. */
export function writeBundledLicenses({ metafile, output, out, label }) {
	const packages = collectPackages(esbuildInputs(metafile, output), process.cwd())
	writeFileSync(out, renderNotices(label, packages))
	const unexpected = unexpectedProblems(problemsOf(packages))
	if (unexpected.length) {
		throw new Error(`bundled licence check failed for ${output}:\n${unexpected.join("\n")}\nSee scripts/third-party/README.md.`)
	}
	return packages
}

/** Problems a release must resolve: packages without licence text, and copyleft licences. */
export function problemsOf(packages) {
	const problems = []
	for (const p of packages) {
		if (p.files.length === 0 && !p.override) problems.push(`${p.name}@${p.version}: no licence file and no override (declared ${p.license})`)
		if (onlyCopyleft(p.license)) problems.push(`${p.name}@${p.version}: copyleft licence ${p.license}`)
		if (p.license === "UNKNOWN" && p.files.length === 0) problems.push(`${p.name}@${p.version}: no declared licence`)
	}
	return problems
}

export function renderNotices(bundleLabel, packages) {
	const rule = "-".repeat(80)
	const out = [
		`THIRD-PARTY LICENCES: ${bundleLabel}`,
		"",
		`${bundleLabel} contains code from the ${packages.length} npm packages below, copied in by the bundler.`,
		"The list is taken from the bundler's own record of the modules it emitted (tree-shaken packages are",
		"not listed). Each entry gives the package, its declared licence and the verbatim text of its licence",
		"files. Generated by scripts/third-party/bundled-licenses.mjs at build time; do not edit by hand.",
		"",
	]
	for (const p of packages) {
		out.push(rule, `${p.name} ${p.version}`, `License: ${p.license}`, rule, "")
		if (p.files.length) {
			for (const f of p.files) out.push(`[${f.file}]`, f.text, "")
		} else if (p.override?.noUpstreamText) {
			out.push(
				`(Neither this package nor its upstream repository publishes licence text; the package is distributed under the ${p.license} licence its package.json declares. Checked: ${p.override.noUpstreamText})`,
				"",
			)
		} else if (p.override) {
			out.push(`(The package ships no licence file; text below is the upstream licence from ${p.override.source}.)`, p.override.text, "")
		} else {
			out.push("(This package contains no licence file; its package.json declares the licence above. NEEDS HUMAN CHECK.)", "")
		}
	}
	return `${out.join("\n").replace(/\s+$/u, "")}\n`
}

/** Paths of inputs esbuild actually emitted into `outfile`. */
export function esbuildInputs(metafile, outfile) {
	const key = Object.keys(metafile.outputs ?? {}).find((k) => path.normalize(k) === path.normalize(outfile))
	if (!key) throw new Error(`esbuild metafile has no output ${outfile} (outputs: ${Object.keys(metafile.outputs ?? {}).join(", ")})`)
	return Object.entries(metafile.outputs[key].inputs)
		.filter(([, v]) => (v.bytesInOutput ?? 0) > 0)
		.map(([k]) => k)
}

/** Vite/rollup plugin: emits assets/THIRD_PARTY_LICENSES.txt next to the bundle. */
export function bundledLicensesPlugin({ label = "AI-Hydro Studio webview bundle (webview-ui/build/assets/index.js)", fileName = "assets/THIRD_PARTY_LICENSES.txt" } = {}) {
	return {
		name: "aihydro-bundled-licenses",
		apply: "build",
		generateBundle(_options, bundle) {
			const ids = []
			for (const chunk of Object.values(bundle)) {
				if (chunk.type !== "chunk") continue
				for (const [id, info] of Object.entries(chunk.modules)) if (info.renderedLength > 0) ids.push(id)
			}
			const packages = collectPackages(ids, process.cwd())
			const problems = problemsOf(packages)
			const unexpected = unexpectedProblems(problems)
			if (unexpected.length) this.error(`bundled licence check failed:\n${unexpected.join("\n")}\nSee scripts/third-party/README.md.`)
			this.emitFile({ type: "asset", fileName, source: renderNotices(label, packages) })
		},
	}
}

function main(argv) {
	const arg = (name) => {
		const i = argv.indexOf(name)
		return i === -1 ? undefined : argv[i + 1]
	}
	const metafilePath = arg("--esbuild-metafile")
	const output = arg("--output")
	const out = arg("--out")
	if (!metafilePath || !output || !out) {
		console.error("usage: bundled-licenses.mjs --esbuild-metafile F --output dist/extension.js --out FILE")
		return 2
	}
	const metafile = JSON.parse(readFileSync(metafilePath, "utf8"))
	try {
		const packages = writeBundledLicenses({ metafile, output, out, label: `bundle ${output}` })
		console.log(`${out}: ${packages.length} packages`)
		return 0
	} catch (e) {
		console.error(e.message)
		return 1
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exit(main(process.argv.slice(2)))
}
