import { expect } from "chai"
import * as fs from "fs"
import * as path from "path"

/**
 * UI contract guards (Wave 0, X0-4 / X0-5 / X0-6 / X0-7):
 *  - brand spelling: "AI-Hydro" in every user-visible string (see docs/ui-naming.md);
 *  - the command palette manifest;
 *  - the hydrology walkthrough and its local images;
 *  - the removed Cline remnants stay removed.
 * These read source files and package.json only; they do not start the extension.
 */

const ROOT = path.resolve(__dirname, "../../..")
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8")
const manifest = JSON.parse(read("package.json"))
const contributes = manifest.contributes

const SKIP_DIRS = new Set(["node_modules", "generated", "proto", "dist", "build", "out", ".git", "__snapshots__"])

function walk(dir: string, exts: string[], out: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) {
				walk(path.join(dir, entry.name), exts, out)
			}
		} else if (exts.some((e) => entry.name.endsWith(e))) {
			out.push(path.join(dir, entry.name))
		}
	}
	return out
}

describe("brand spelling guard (F-NM1)", () => {
	// A line may opt out with the marker below, for text that must quote the old spelling (for example a test of the guard).
	const ALLOW = "brand-guard:allow"
	// Built so that this file does not match its own pattern.
	const BAD = new RegExp(["AI", " ", "Hydro"].join(""))

	it('the old two-word spelling never appears in extension source, webview source, the walkthrough or package.json', () => {
		const files = [
			...walk(path.join(ROOT, "src"), [".ts", ".tsx", ".js", ".json", ".md"]),
			...walk(path.join(ROOT, "webview-ui/src"), [".ts", ".tsx", ".css", ".md"]),
			...walk(path.join(ROOT, "walkthrough"), [".md", ".svg"]),
			path.join(ROOT, "package.json"),
		]
		const hits: string[] = []
		for (const file of files) {
			fs.readFileSync(file, "utf8")
				.split("\n")
				.forEach((line, i) => {
					if (BAD.test(line) && !line.includes(ALLOW)) {
						hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 100)}`)
					}
				})
		}
		expect(hits, `Use "AI-Hydro" (see docs/ui-naming.md). Offending lines:\n${hits.join("\n")}`).to.deep.equal([])
	})

	it("the naming glossary exists", () => {
		expect(fs.existsSync(path.join(ROOT, "docs/ui-naming.md"))).to.equal(true)
	})
})

describe("command palette manifest (F-CP1 to F-CP4)", () => {
	const commands: Array<{ command: string; title: string; category?: string; when?: string }> = contributes.commands
	const palette: Array<{ command: string; when?: string }> = contributes.menus.commandPalette

	it("no title starts with its own category, so the palette never shows a doubled prefix", () => {
		const doubled = commands
			.filter((c) => c.category && c.title.toLowerCase().startsWith(c.category.toLowerCase()))
			.map((c) => `${c.command}: ${c.category}: ${c.title}`)
		expect(doubled).to.deep.equal([])
	})

	it("every command has a category", () => {
		expect(commands.filter((c) => !c.category).map((c) => c.command)).to.deep.equal([])
	})

	it("'Settings' and the new-chat command are categorised and named consistently with the sidebar button", () => {
		const byId = Object.fromEntries(commands.map((c) => [c.command, c]))
		expect(byId["aihydro.settingsButtonClicked"].category).to.equal("AI-Hydro")
		expect(byId["aihydro.plusButtonClicked"].category).to.equal("AI-Hydro")
		// The sidebar header button says "New Task"; the palette must use the same word (the Chat rename is a later change).
		expect(byId["aihydro.plusButtonClicked"].title).to.equal("New Task")
	})

	it("the dev command is hidden outside dev mode through menus.commandPalette, not through a dead 'when' on the command", () => {
		const dev = commands.find((c) => c.command === "aihydro.dev.createTestTasks")
		expect(dev, "dev command declared").to.not.equal(undefined)
		expect(dev?.when, "a 'when' inside contributes.commands is ignored by VS Code").to.equal(undefined)
		const entry = palette.find((p) => p.command === "aihydro.dev.createTestTasks")
		expect(entry?.when).to.equal("aihydro.isDevMode")
	})

	it("the duplicate GEE test command is not listed (the Connectors panel still calls it by id)", () => {
		expect(palette.find((p) => p.command === "aihydro.gee.test")?.when).to.equal("false")
	})

	it("Generate Commit Message is gone everywhere in the manifest", () => {
		expect(JSON.stringify(manifest)).to.not.match(/CommitMessage|Commit Message/i)
		expect(contributes.menus["scm/title"]).to.equal(undefined)
	})

	it("every palette entry and keybinding refers to a declared command", () => {
		const ids = new Set(commands.map((c) => c.command))
		for (const p of palette) {
			expect(ids.has(p.command), p.command).to.equal(true)
		}
		for (const k of contributes.keybindings) {
			expect(ids.has(k.command), k.command).to.equal(true)
		}
	})
})

describe("hydrology walkthrough (F-WT1)", () => {
	const walkthrough = contributes.walkthroughs[0]
	const steps: Array<{
		id: string
		title: string
		description: string
		media: { markdown: string }
		completionEvents?: string[]
	}> = walkthrough.steps

	it("has 3 to 5 steps and no coding-assistant copy", () => {
		expect(steps.length).to.be.within(3, 5)
		const text = JSON.stringify(walkthrough) + steps.map((s) => read(s.media.markdown)).join("\n")
		expect(text).to.not.match(/codebase|diff|autocomplete|best AI models/i)
	})

	it("each step title equals the heading of its markdown file", () => {
		for (const step of steps) {
			const heading = read(step.media.markdown).split("\n")[0].replace(/^#\s+/, "").trim()
			expect(step.title, step.media.markdown).to.equal(heading)
		}
	})

	it("loads nothing from the network: no remote images, no Cline bucket", () => {
		const files = steps.map((s) => s.media.markdown)
		for (const f of files) {
			const body = read(f)
			expect(body, f).to.not.match(/storage\.googleapis\.com/)
			expect(body, f).to.not.match(/!\[[^\]]*\]\(\s*https?:/)
			expect(body, f).to.not.match(/<img[^>]+src=["']https?:/i)
		}
		expect(JSON.stringify(walkthrough)).to.not.match(/https?:\/\//)
	})

	it("every image a step shows is a local file that ships with the extension", () => {
		for (const step of steps) {
			const dir = path.dirname(step.media.markdown)
			const body = read(step.media.markdown)
			const images = [...body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1])
			expect(images.length, `${step.media.markdown} shows an image`).to.be.greaterThan(0)
			for (const rel of images) {
				expect(fs.existsSync(path.join(ROOT, dir, rel)), `${dir}/${rel}`).to.equal(true)
			}
		}
	})

	it("every command a step links or waits for is declared", () => {
		const ids = new Set(contributes.commands.map((c: { command: string }) => c.command))
		for (const step of steps) {
			const linked = [
				...step.description.matchAll(/\(command:([\w.]+)\)/g),
				...read(step.media.markdown).matchAll(/\(command:([\w.]+)\)/g),
			].map((m) => m[1])
			const waited = (step.completionEvents ?? []).map((e) => e.replace(/^onCommand:/, ""))
			for (const id of [...linked, ...waited]) {
				expect(ids.has(id), `${step.id}: ${id}`).to.equal(true)
			}
		}
	})
})

describe("removed Cline remnants stay removed", () => {
	it("the audit settings copy matches the gate, which is on by default (F-SET1)", () => {
		const text = read("webview-ui/src/components/settings/sections/FeatureSettingsSection.tsx")
		expect(text).to.not.match(/Display only/)
		expect(text).to.not.match(/never blocks/)
		expect(text).to.match(/up to\s+2\s+extra\s+model\s+requests/)
	})

	it("no account, credits, dictation or commit-message UI is shipped in the webview source", () => {
		const files = walk(path.join(ROOT, "webview-ui/src"), [".ts", ".tsx"]).filter(
			(f) => !f.includes("/services/grpc-client") && !f.includes("__tests__") && !f.includes("OcaProvider"),
		)
		const offenders: string[] = []
		for (const f of files) {
			// Line comments are not UI text.
			const body = fs
				.readFileSync(f, "utf8")
				.split("\n")
				.map((line) => line.replace(/(^|\s)\/\/.*$/, ""))
				.join("\n")
			if (
				/\b(?:credits|dictation)\b/i.test(body) ||
				/\b(?:AiHydroAuthContext|AccountServiceClient|DictationServiceClient)\b/.test(body)
			) {
				offenders.push(path.relative(ROOT, f))
			}
		}
		expect(offenders).to.deep.equal([])
	})

	it("the system prompt no longer offers the code-definition tool or the CLI subagent", () => {
		const prompts = walk(path.join(ROOT, "src/core/prompts"), [".ts"]).filter((f) => !f.includes("__tests__"))
		const offenders = prompts.filter((f) =>
			/list_code_definition_names|CLI_SUBAGENTS|USING THE (?:AIHYDRO|AI-HYDRO) CLI/i.test(fs.readFileSync(f, "utf8")),
		)
		expect(offenders.map((f) => path.relative(ROOT, f))).to.deep.equal([])
	})

	it("the browser tool is off by default", () => {
		const { DEFAULT_BROWSER_SETTINGS } = require("../BrowserSettings")
		expect(DEFAULT_BROWSER_SETTINGS.disableToolUse).to.equal(true)
	})

	it("nothing in the extension reads AIHYDRO_PROFILE (the approval terminal only clears it)", () => {
		const files = walk(path.join(ROOT, "src"), [".ts"]).filter((f) => !f.includes("__tests__") && !f.includes("/test/"))
		const readers = files.filter((f) => /process\.env\.AIHYDRO_PROFILE/.test(fs.readFileSync(f, "utf8")))
		expect(readers.map((f) => path.relative(ROOT, f))).to.deep.equal([])
	})
})
