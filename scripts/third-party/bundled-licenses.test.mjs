import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, describe, it } from "node:test"
import {
	collectPackages,
	esbuildInputs,
	onlyCopyleft,
	packageRootOf,
	problemsOf,
	renderNotices,
	unexpectedProblems,
} from "./bundled-licenses.mjs"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aihydro-bundled-licences-"))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

function pkg(rel, json, files = {}) {
	const dir = path.join(tmp, rel)
	fs.mkdirSync(dir, { recursive: true })
	fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(json))
	for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text)
	return dir
}

pkg("node_modules/alpha", { name: "alpha", version: "1.0.0", license: "MIT" }, { LICENSE: "MIT text\r\n" })
pkg("node_modules/@s/beta", { name: "@s/beta", version: "2.0.0", license: "BSD-3-Clause" })
pkg("node_modules/alpha/node_modules/gamma", { name: "gamma", version: "0.1.0", license: "LGPL-2.1+" }, { COPYING: "lgpl" })
pkg("node_modules/delta", { name: "delta", version: "1.0.0", license: "(MIT OR GPL-3.0-or-later)" }, { "LICENSE.md": "dual" })

describe("bundled licences", () => {
	it("maps module paths to package roots, including scopes and nesting", () => {
		assert.equal(packageRootOf("src/a.ts"), null)
		assert.equal(packageRootOf("node_modules/alpha/lib/x.js"), "node_modules/alpha")
		assert.equal(packageRootOf("/r/node_modules/@s/beta/dist/i.js"), "/r/node_modules/@s/beta")
		assert.equal(packageRootOf("node_modules/alpha/node_modules/gamma/i.js"), "node_modules/alpha/node_modules/gamma")
	})

	it("collects each bundled package once, sorted, with verbatim licence files", () => {
		const packages = collectPackages(
			[
				"node_modules/delta/i.js",
				"node_modules/alpha/a.js",
				"node_modules/alpha/b.js",
				"node_modules/@s/beta/i.js",
				"node_modules/alpha/node_modules/gamma/i.js",
				"src/first-party.ts",
			],
			tmp,
			{ "@s/beta@2.0.0": { source: "https://example.test/LICENSE", text: "BSD text" } },
		)
		assert.deepEqual(
			packages.map((p) => `${p.name}@${p.version}`),
			["@s/beta@2.0.0", "alpha@1.0.0", "delta@1.0.0", "gamma@0.1.0"],
		)
		assert.equal(packages[1].files[0].text, "MIT text")
		assert.equal(packages[0].override.text, "BSD text")
	})

	it("reports missing text and copyleft-only licences, not elective dual licences", () => {
		assert.equal(onlyCopyleft("(MIT OR GPL-3.0-or-later)"), false)
		assert.equal(onlyCopyleft("(Apache-2.0 AND BSD-3-Clause)"), false)
		assert.equal(onlyCopyleft("LGPL-2.1+"), true)
		const packages = collectPackages(["node_modules/@s/beta/i.js", "node_modules/alpha/node_modules/gamma/i.js"], tmp, {})
		const problems = problemsOf(packages)
		assert.deepEqual(problems, [
			"@s/beta@2.0.0: no licence file and no override (declared BSD-3-Clause)",
			"gamma@0.1.0: copyleft licence LGPL-2.1+",
		])
		assert.deepEqual(unexpectedProblems(problems, [{ problem: problems[1], decision: "x" }]), [problems[0]])
	})

	it("renders deterministically and states when no upstream text exists", () => {
		const packages = collectPackages(["node_modules/@s/beta/i.js"], tmp, { "@s/beta@2.0.0": { noUpstreamText: "repo root" } })
		const a = renderNotices("test bundle", packages)
		assert.equal(a, renderNotices("test bundle", packages))
		assert.match(a, /Neither this package nor its upstream repository publishes licence text/)
		assert.ok(!a.includes(tmp), "no absolute paths in output")
	})

	it("reads only esbuild inputs that contributed bytes", () => {
		const metafile = { outputs: { "dist/extension.js": { inputs: { "node_modules/a/i.js": { bytesInOutput: 3 }, "node_modules/b/i.js": { bytesInOutput: 0 } } } } }
		assert.deepEqual(esbuildInputs(metafile, "dist/extension.js"), ["node_modules/a/i.js"])
		assert.throws(() => esbuildInputs(metafile, "dist/other.js"), /no output/)
	})

	it("every recorded override names its source or where upstream was checked", () => {
		const doc = JSON.parse(fs.readFileSync(new URL("./licence-overrides.json", import.meta.url), "utf8"))
		for (const [key, value] of Object.entries(doc.packages)) {
			assert.ok(value.noUpstreamText ? value.noUpstreamText.length > 10 : value.source && value.text, key)
		}
		for (const known of doc.knownProblems) assert.ok(known.problem && known.decision, JSON.stringify(known))
	})
})
