import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { scan } from "./check-bundle-leaks.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
// Banned literals are assembled so this test file is itself clean.
const NPM = ["npm install -g", "aihydro"].join(" ")
const HOST = ["aihydro-recognition.aihydro-mgalib", "workers", "dev"].join(".")
const GATE = "AI-Hydro recognition skipped: telemetry is disabled"

function fixture(files) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "leak-guard-"))
	for (const [rel, text] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
		fs.writeFileSync(path.join(root, rel), text)
	}
	return root
}
const rules = (root, targets) => scan(root, targets, { explicit: true }).findings.map((f) => f.rule)

test("clean bundles pass", () => {
	const root = fixture({ "dist/extension.js": 'var a="hello";', "webview-ui/build/assets/index.js": "var b=1" })
	assert.deepEqual(rules(root, ["dist", "webview"]), [])
})

for (const [name, text, rule] of [
	["npm install suggestion", `x("${NPM}")`, "npm-global-install"],
	["cline.bot", 'x("https://' + "cline" + '.bot/docs")', "cline.bot"],
	["cline repo link", 'x("https://github.com/' + "cline/cline" + '/issues")', "cline-repo-link"],
	["cline wiki link", 'x("https://github.com/' + "cline/cline" + '/wiki/Troubleshooting")', "cline-wiki-link"],
	["referer to cline", '{"HTTP-Referer":"https://' + "cline" + '.example"}', "http-referer-cline"],
	["foreign workers.dev", 'x("https://evil.example-user.workers.dev/v1")', "workers.dev"],
]) {
	test(`dist bundle containing ${name} fails`, () => {
		const root = fixture({ "dist/extension.js": text })
		assert.ok(rules(root, ["dist"]).includes(rule), `expected rule ${rule}`)
	})
	test(`webview bundle containing ${name} fails`, () => {
		const root = fixture({ "webview-ui/build/assets/index.js": text })
		assert.ok(rules(root, ["webview"]).includes(rule), `expected rule ${rule}`)
	})
}

test("recognition host is allowed only together with the telemetry consent gate", () => {
	const ungated = fixture({ "dist/extension.js": `x("https://${HOST}/v1")` })
	assert.ok(rules(ungated, ["dist"]).includes("recognition-host-without-consent-gate"))
	const gated = fixture({ "dist/extension.js": `x("https://${HOST}/v1");y("${GATE}")` })
	assert.deepEqual(rules(gated, ["dist"]), [])
	const inWebview = fixture({ "webview-ui/build/assets/index.js": `x("https://${HOST}/v1")` })
	assert.ok(rules(inWebview, ["webview"]).includes("recognition-host-in-webview"))
})

test("an explicitly requested target that is missing is an error", () => {
	const root = fixture({ "dist/extension.js": "" })
	assert.throws(() => scan(root, ["webview"], { explicit: true }), /not found/)
})

test("the npm global install suggestion appears nowhere in src/ or webview-ui/src/", () => {
	const { findings, scanned } = scan(repoRoot, ["src"], { explicit: true })
	assert.ok(scanned[0].files > 100, "should have scanned the source trees")
	assert.deepEqual(findings, [])
})

test("the upstream webview page title fails the webview scan", () => {
	const root = fixture({ "webview-ui/build/index.html": `<title>${"Cline"} Webview</title>` })
	assert.ok(rules(root, ["webview"]).includes("cline-webview-title"))
})
