import { expect } from "chai"
import { describe, it } from "mocha"
import * as fs from "node:fs"
import * as path from "node:path"

/**
 * ADR-004 / Studio P1: the single user-facing name is "AI-Hydro Studio".
 * Internal ids (preview_html, aihydro.htmlPreview.*, HtmlPreview* identifiers,
 * proto names) stay for compatibility; only strings a user or the agent reads
 * must not carry the old names.
 */
const OLD_NAMES = /HTML [Pp]review|AI-Hydro Preview|Preview panel|HTML previews/

const ROOT = path.resolve(__dirname, "../../../..")

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			if (["node_modules", "dist", "build", "__tests__", "generated", "proto", "test"].includes(entry.name)) continue
			walk(full, out)
		} else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) && !entry.name.endsWith(".d.ts")) {
			out.push(full)
		}
	}
	return out
}

/** Source with comments and console.* lines removed: what is left can reach a user or the agent. */
function userVisibleSource(file: string): string {
	return fs
		.readFileSync(file, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split("\n")
		.filter((l) => !/^\s*\/\//.test(l) && !/console\.(log|warn|error|info|debug)/.test(l))
		.map((l) => l.replace(/\s\/\/\s.*$/, ""))
		.join("\n")
}

function offenders(files: string[]): string[] {
	const found: string[] = []
	for (const f of files) {
		userVisibleSource(f)
			.split("\n")
			.forEach((line) => {
				if (OLD_NAMES.test(line)) found.push(`${path.relative(ROOT, f)}: ${line.trim()}`)
			})
	}
	return found
}

function collectStrings(node: unknown, key: string, out: Array<{ key: string; value: string }>) {
	if (typeof node === "string") {
		if (["title", "description", "markdownDescription", "tooltip", "label", "name", "displayName"].includes(key)) {
			out.push({ key, value: node })
		}
	} else if (Array.isArray(node)) {
		for (const n of node) collectStrings(n, key, out)
	} else if (node && typeof node === "object") {
		for (const [k, v] of Object.entries(node)) collectStrings(v, k, out)
	}
}

describe("Studio naming guard (one name everywhere)", () => {
	it("package.json contributes has no old product name in titles, descriptions or tooltips", () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
		const strings: Array<{ key: string; value: string }> = []
		collectStrings(pkg.contributes, "", strings)
		const bad = strings.filter((s) => OLD_NAMES.test(s.value)).map((s) => `${s.key}: ${s.value}`)
		expect(bad, bad.join("\n")).to.deep.equal([])
	})

	it("the Explorer menu and toolbar use the Studio name", () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
		const titles = (pkg.contributes.commands as Array<{ title: string }>).map((c) => c.title)
		expect(titles).to.include("Add to AI-Hydro Studio")
		expect(titles).to.include("AI-Hydro Studio")
	})

	it("webview strings have no old product name", () => {
		const bad = offenders(walk(path.join(ROOT, "webview-ui/src")))
		expect(bad, bad.join("\n")).to.deep.equal([])
	})

	it("extension messages, errors and agent-facing tool text have no old product name", () => {
		const files = [
			...walk(path.join(ROOT, "src/core/controller/htmlPreview")),
			...walk(path.join(ROOT, "src/core/task/tools/handlers")).filter((f) => /PreviewHtml/.test(f)),
			...walk(path.join(ROOT, "src/core/prompts/system-prompt/tools")).filter((f) => /preview_html/.test(f)),
			...walk(path.join(ROOT, "src/services/artifact-preview")),
			...walk(path.join(ROOT, "src/hosts/vscode")).filter((f) => /HtmlPreview/.test(f)),
			path.join(ROOT, "src/extension.ts"),
		]
		const bad = offenders(files)
		expect(bad, bad.join("\n")).to.deep.equal([])
	})

	it("keeps the compatibility ids unchanged", () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
		const ids = (pkg.contributes.commands as Array<{ command: string }>).map((c) => c.command)
		expect(ids).to.include("aihydro.htmlPreviewButtonClicked")
		expect(ids).to.include("aihydro.addFileToHtmlPreview")
		const tool = fs.readFileSync(path.join(ROOT, "src/core/prompts/system-prompt/tools/preview_html.ts"), "utf8")
		expect(tool).to.match(/preview_html/)
	})
})
