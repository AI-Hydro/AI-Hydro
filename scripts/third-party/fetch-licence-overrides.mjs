/**
 * Maintainer tool (network; not run by builds or CI). For bundled packages that ship no licence file,
 * fetch the licence file of the package's upstream GitHub repository through the GitHub licence API
 * (`gh api repos/<owner>/<repo>/license`) and record it verbatim in licence-overrides.json with its
 * source URL and git blob SHA, so the build-time notices can reproduce real upstream text.
 *
 *   node scripts/third-party/fetch-licence-overrides.mjs name@version [name@version ...]
 *   node scripts/third-party/fetch-licence-overrides.mjs name@version=owner/repo:path/to/LICENSE
 *   node scripts/third-party/fetch-licence-overrides.mjs "name@version=none:<where you looked>"
 *
 * The second form fetches a named file (for packages without a usable "repository" field). The third
 * records that upstream publishes no licence text at all; the notices then carry the declared licence
 * identifier and that statement, and the record names the places checked.
 *
 * Packages are looked up in ./node_modules and ./webview-ui/node_modules. A package whose repository is
 * not on GitHub, or whose repository has no detectable licence file, is reported and left out: add it by
 * hand with the same fields, or treat it as a human check.
 */
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")
const overridesPath = path.join(here, "licence-overrides.json")

function findPackage(name, version) {
	// Nested copies (node_modules/x/node_modules/name) count: the bundled version may not be the hoisted one.
	for (const base of [root, path.join(root, "webview-ui")]) {
		const res = spawnSync("find", ["node_modules", "-path", `*node_modules/${name}/package.json`, "-not", "-path", "*/test/*"], {
			cwd: base,
			encoding: "utf8",
		})
		for (const rel of res.stdout.split("\n").filter(Boolean).sort()) {
			const pkg = JSON.parse(readFileSync(path.join(base, rel), "utf8"))
			if (pkg.name === name && pkg.version === version) return pkg
		}
	}
	return null
}

function githubRepo(pkg) {
	const url = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url
	const m = url && /github\.com[/:]([^/]+)\/([^/#.]+)/.exec(url)
	return m ? `${m[1]}/${m[2]}` : url && /^[\w-]+\/[\w.-]+$/.test(url) ? url : null
}

const doc = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, "utf8")) : { packages: {} }
doc.description =
	"Verbatim upstream licence text for bundled packages that ship no licence file. Written by fetch-licence-overrides.mjs; reviewed by hand."
let failures = 0
for (const spec of process.argv.slice(2)) {
	const [key, manual] = spec.includes("=") ? [spec.slice(0, spec.indexOf("=")), spec.slice(spec.indexOf("=") + 1)] : [spec, null]
	const at = key.lastIndexOf("@")
	const [name, version] = [key.slice(0, at), key.slice(at + 1)]
	if (manual?.startsWith("none:")) {
		doc.packages[key] = { source: null, noUpstreamText: manual.slice(5) }
		console.log(`${key}: recorded as no upstream licence text`)
		continue
	}
	if (manual) {
		const [repo, file] = [manual.slice(0, manual.indexOf(":")), manual.slice(manual.indexOf(":") + 1)]
		const res = spawnSync("gh", ["api", `repos/${repo}/contents/${file}`], { encoding: "utf8" })
		if (res.status !== 0) {
			console.error(`${key}: gh api repos/${repo}/contents/${file} failed: ${res.stderr.trim()}`)
			failures++
			continue
		}
		const body = JSON.parse(res.stdout)
		doc.packages[key] = { source: body.html_url, blobSha: body.sha, spdx: null, text: Buffer.from(body.content, "base64").toString("utf8") }
		console.log(`${key}: ${body.html_url}`)
		continue
	}
	const pkg = findPackage(name, version)
	const repo = pkg && githubRepo(pkg)
	if (!repo) {
		console.error(`${key}: not installed or no GitHub repository`)
		failures++
		continue
	}
	const res = spawnSync("gh", ["api", `repos/${repo}/license`], { encoding: "utf8" })
	if (res.status !== 0) {
		console.error(`${spec}: gh api repos/${repo}/license failed: ${res.stderr.trim()}`)
		failures++
		continue
	}
	const body = JSON.parse(res.stdout)
	doc.packages[key] = {
		source: body.html_url,
		blobSha: body.sha,
		spdx: body.license?.spdx_id ?? null,
		text: Buffer.from(body.content, "base64").toString("utf8"),
	}
	console.log(`${spec}: ${body.html_url} (${body.license?.spdx_id})`)
}
doc.packages = Object.fromEntries(Object.entries(doc.packages).sort(([a], [b]) => (a < b ? -1 : 1)))
writeFileSync(overridesPath, `${JSON.stringify(doc, null, "\t")}\n`)
process.exit(failures ? 1 : 0)
