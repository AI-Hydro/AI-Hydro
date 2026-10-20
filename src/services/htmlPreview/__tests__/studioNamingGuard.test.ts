import * as fs from "node:fs"
import * as path from "node:path"
import { expect } from "chai"
import { describe, it } from "mocha"

/**
 * ADR-004 / Studio P1: the single user-facing name is "AI-Hydro Studio".
 * Internal ids (preview_html, aihydro.htmlPreview.*, HtmlPreview* identifiers,
 * proto names) stay for compatibility; only strings a user or the agent reads
 * must not carry the old names.
 */
const OLD_NAMES = /html[ -]?preview|aihydro[ -]?preview|preview panel/i

/**
 * Compatibility identifiers that legitimately keep the old spelling (ADR-004
 * policy 3): identifiers and file names, tool names, command and message ids,
 * settings ids. They are removed before the old-name regex runs, so only
 * human-readable text can trip the guard.
 */
const COMPATIBILITY_IDS = new RegExp(
	[
		"\\bshow_html_preview\\b",
		"\\bpreview_html\\b",
		"\\bhtml_preview\\w*",
		"\\bhtml-preview[\\w.-]*", // doc/file names such as html-preview.md
		"[A-Za-z_]*HtmlPreview[A-Za-z_]*", // identifiers and command ids (addFileToHtmlPreview, VscodeHtmlPreviewProvider)
		"[\\w.]*htmlPreview[\\w.]*", // settings and telemetry ids (aihydro.htmlPreview.*, aihydro_htmlPreviewButton)
		"aihydro-preview-[\\w-]*", // webview message types, temp file prefixes
	].join("|"),
	"g",
)
const hasOldName = (text: string): boolean => OLD_NAMES.test(text.replace(COMPATIBILITY_IDS, ""))

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
				if (hasOldName(line)) found.push(`${path.relative(ROOT, f)}: ${line.trim()}`)
			})
	}
	return found
}

function markdownFiles(): string[] {
	const out = [path.join(ROOT, "README.md")]
	const walkMd = (dir: string) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name)
			if (entry.isDirectory()) walkMd(full)
			else if (entry.name.endsWith(".md")) out.push(full)
		}
	}
	walkMd(path.join(ROOT, "docs/guide"))
	return out
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
		const bad = strings.filter((s) => hasOldName(s.value)).map((s) => `${s.key}: ${s.value}`)
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

	it("README and the user guide have no old product name", () => {
		const bad: string[] = []
		for (const f of markdownFiles()) {
			fs.readFileSync(f, "utf8")
				.split("\n")
				.forEach((line, i) => {
					if (hasOldName(line)) bad.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim()}`)
				})
		}
		expect(bad, bad.join("\n")).to.deep.equal([])
	})

	it("the guard regex is case-insensitive and still catches real old names", () => {
		for (const text of [
			"HTML Preview",
			"html preview",
			"Html-Preview panel",
			"AI-Hydro Preview panel",
			"AIHYDRO PREVIEW",
			"the Preview panel",
		]) {
			expect(hasOldName(text), text).to.equal(true)
		}
		for (const text of [
			"aihydro.htmlPreview.pythonExecution",
			"show_html_preview",
			"preview_html",
			"docs/guide/html-preview.md",
			"VscodeHtmlPreviewProvider",
			"aihydro-preview-event",
			"AI-Hydro Studio",
		]) {
			expect(hasOldName(text), text).to.equal(false)
		}
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
