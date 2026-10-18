#!/usr/bin/env node
/** Fails if the production webview bundle contains the UI harness (registry, fixtures, FIXTURE badge). */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const assets = join(root, "webview-ui/build/assets")
if (!existsSync(assets)) {
	console.error(`No build output at ${assets}; run npm run build:webview first.`)
	process.exit(2)
}
const needles = ["FIXTURE", "fx-session-001", "screens/registry", "synthetic data, not a result", "recorded output, replayed offline", "spliced recorded fields", "fx-run-0101"]
const hits = []
for (const file of readdirSync(assets)) {
	if (!/\.(js|css|html|map)$/.test(file)) continue
	const text = readFileSync(join(assets, file), "utf8")
	for (const needle of needles) if (text.includes(needle)) hits.push(`${file}: ${needle}`)
}
if (hits.length) {
	console.error(`UI harness leaked into the production bundle:\n${hits.join("\n")}`)
	process.exit(1)
}
console.log(JSON.stringify({ result: "ok", checked: assets, needles }))
