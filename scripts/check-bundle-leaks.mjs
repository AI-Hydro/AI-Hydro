#!/usr/bin/env node
/**
 * Release leak guard (vision-2040 WP-0).
 *
 * Fails if shipped code or user-visible text carries upstream (Cline) identity or an unsafe
 * install suggestion. Targets:
 *   src      extension + webview source (the install-command rule only; comments may cite upstream)
 *   dist     packaged extension bundle  (dist/extension.js and sibling .js/.json)
 *   webview  built webview bundle       (webview-ui/build, .js/.css/.html)
 *
 * Usage: node scripts/check-bundle-leaks.mjs [--target src|dist|webview ...] [--root <dir>]
 * With no --target, every target whose directory exists is scanned (dist and webview are skipped
 * with a notice when not built). An explicit --target that is missing is an error.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Patterns are assembled from parts so this file never contains the banned literals itself.
const NPM_INSTALL = ["npm install -g", "aihydro"].join(" ")
const RECOGNITION_HOST = ["aihydro-recognition.aihydro-mgalib", "workers", "dev"].join(".")
const RECOGNITION_CONSENT_MARKER = "recognition skipped: telemetry is disabled"

/**
 * @typedef {{ id: string, test: (text: string) => string[] , targets: string[] }} Rule
 * Each rule returns a list of short human-readable hit descriptions.
 */
const literal = (needle) => (text) => (text.includes(needle) ? [needle] : [])
const regex = (re) => (text) => {
	const m = text.match(re)
	return m ? [m[0].slice(0, 120)] : []
}

/** @type {Rule[]} */
export const RULES = [
	{ id: "npm-global-install", test: literal(NPM_INSTALL), targets: ["src", "dist", "webview"] },
	{ id: "cline.bot", test: literal("cline" + ".bot"), targets: ["dist", "webview"] },
	{ id: "cline-repo-link", test: literal("github.com/cline" + "/cline"), targets: ["dist", "webview"] },
	{ id: "cline-wiki-link", test: literal("github.com/cline" + "/cline/wiki"), targets: ["dist", "webview"] },
	{
		id: "http-referer-cline",
		test: regex(/http-referer["']?\s*:\s*["'`][^"'`]*cline/i),
		targets: ["dist", "webview"],
	},
	{
		// The personal recognition host may ship only together with its telemetry-consent gate.
		id: "workers.dev",
		test: (text) => {
			const hits = []
			for (const m of text.matchAll(/[a-z0-9.-]+\.workers\.dev/gi)) {
				if (m[0].toLowerCase() === RECOGNITION_HOST) continue // gated below
				hits.push(m[0])
			}
			return hits
		},
		targets: ["dist", "webview"],
	},
	{
		id: "recognition-host-without-consent-gate",
		test: (text) => (text.includes(RECOGNITION_HOST) && !text.includes(RECOGNITION_CONSENT_MARKER) ? [RECOGNITION_HOST] : []),
		targets: ["dist"],
	},
	{
		id: "recognition-host-in-webview",
		test: literal(RECOGNITION_HOST),
		targets: ["webview"],
	},
]

/**
 * Allowlist: { rule, file (substring), reason }. Empty on purpose; add an entry only with a reason.
 * (README attribution to the upstream project is not packaged, so it needs no entry.)
 */
export const ALLOWLIST = []

const TEXT_EXT = {
	src: /\.(ts|tsx)$/,
	dist: /\.(js|cjs|mjs|json|html|css)$/,
	webview: /\.(js|css|html|json)$/,
}
const SKIP_DIRS = new Set(["node_modules", ".git", "__tests__", "test", "tests"])

function* walk(dir, target) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (target === "src" && SKIP_DIRS.has(entry.name)) continue
			yield* walk(path.join(dir, entry.name), target)
		} else if (TEXT_EXT[target].test(entry.name)) {
			if (target === "src" && /\.(test|spec)\.tsx?$/.test(entry.name)) continue
			if (entry.name.endsWith("-metafile.json")) continue // esbuild metafile lists source paths, not shipped text
			yield path.join(dir, entry.name)
		}
	}
}

function targetDir(root, target) {
	if (target === "dist") return path.join(root, "dist")
	if (target === "webview") return path.join(root, "webview-ui", "build")
	return null
}

export function scan(root, targets, { explicit = false } = {}) {
	const findings = []
	const scanned = []
	for (const target of targets) {
		const dirs = target === "src" ? [path.join(root, "src"), path.join(root, "webview-ui", "src")] : [targetDir(root, target)]
		const present = dirs.filter((d) => fs.existsSync(d))
		if (present.length === 0) {
			if (explicit) throw new Error(`Target "${target}" not found under ${root}; build it first.`)
			console.warn(`check-bundle-leaks: skipping "${target}" (not built)`)
			continue
		}
		let files = 0
		for (const dir of present) {
			for (const file of walk(dir, target)) {
				files++
				const text = fs.readFileSync(file, "utf8")
				const rel = path.relative(root, file)
				for (const rule of RULES) {
					if (!rule.targets.includes(target)) continue
					for (const hit of rule.test(text)) {
						if (ALLOWLIST.some((a) => a.rule === rule.id && rel.includes(a.file))) continue
						findings.push({ rule: rule.id, file: rel, hit })
					}
				}
			}
		}
		scanned.push({ target, files })
	}
	return { findings, scanned }
}

function main() {
	const argv = process.argv.slice(2)
	const targets = []
	let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--target") targets.push(argv[++i])
		else if (argv[i] === "--root") root = path.resolve(argv[++i])
		else throw new Error(`Unknown argument ${argv[i]}`)
	}
	for (const t of targets) if (!["src", "dist", "webview"].includes(t)) throw new Error(`Unknown target ${t}`)
	const explicit = targets.length > 0
	const { findings, scanned } = scan(root, explicit ? targets : ["src", "dist", "webview"], { explicit })
	if (scanned.length === 0) {
		console.error("check-bundle-leaks: nothing was scanned")
		process.exit(2)
	}
	if (findings.length > 0) {
		console.error(`Release leak guard FAILED (${findings.length} hit(s)):`)
		for (const f of findings) console.error(`  [${f.rule}] ${f.file}: ${f.hit}`)
		process.exit(1)
	}
	console.log(`Release leak guard passed: ${scanned.map((s) => `${s.target}=${s.files} files`).join(", ")}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
