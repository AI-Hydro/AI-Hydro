import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { commandMentionsProtectedPath } from "../../commandPolicy"
import { computeProtectedRoots, isProtectedPath } from "../../protectedPaths"
import { BUILTIN_DEFINITIONS, capFor, EXPLORER_DEFINITION, REVIEWER_DEFINITION, sha256Hex } from "../agentDefinition"
import {
	AGENT_BODY_MAX_CHARS,
	AGENT_FILE_MAX_BYTES,
	AGENT_FILES_PER_DIR,
	assertNarrower,
	loadAgentRegistry,
	MAX_PROBLEM_REASON_CHARS,
	parseAgentFile,
	parseFrontMatter,
	splitFile,
	workspaceAgentsDir,
} from "../agentFiles"
import { formatReportsForParent } from "../subagentReports"

const file = (front: string, body = "") => `---\n${front}\n---\n${body}`
const ctx = (stem = "my-agent") => ({ path: `/w/.aihydrorules/agents/${stem}.md`, source: "workspace" as const, stem })
const ok = (raw: string, stem?: string) => {
	const parsed = parseAgentFile(raw, ctx(stem))
	if (!parsed.ok) {
		throw new Error(`expected a definition, got: ${parsed.reason}`)
	}
	return parsed.definition
}
const refused = (raw: string, stem?: string) => {
	const parsed = parseAgentFile(raw, ctx(stem))
	if (parsed.ok) {
		throw new Error("expected a refusal")
	}
	return parsed.reason
}

describe("agent files: narrowing", () => {
	it("a file that only extends a built-in is that built-in with its own id, source, path and the file's sha256", () => {
		const raw = file("extends: explorer")
		const d = ok(raw)
		expect(d).to.deep.include({
			id: "my-agent",
			displayName: "My agent",
			extends: "explorer",
			source: "workspace",
			path: "/w/.aihydrorules/agents/my-agent.md",
			sha256: sha256Hex(raw),
		})
		expect([...d.builtinAllow]).to.deep.equal([...EXPLORER_DEFINITION.builtinAllow])
		expect(d.budget).to.deep.equal(EXPLORER_DEFINITION.budget)
		expect(d.mcpPolicy).to.equal("read")
		expect(d.reportSchema).to.equal("findings")
		expect(d.canSpawn).to.equal(false)
		expect(d.body).to.equal(undefined)
		assertNarrower(EXPLORER_DEFINITION, d)
	})

	it("can remove tools, and the base's order is kept; removing use_mcp_tool takes MCP away", () => {
		const d = ok(file("extends: explorer\ntools: [search_files, read_file]"))
		expect([...d.builtinAllow]).to.deep.equal(["read_file", "search_files"])
		const caps = capFor({ canCall: () => true, workspaceTrusted: true, parentIsChild: false }, d)!
		expect(caps.mcpEnabled).to.equal(false)
		expect(caps.reportTool).to.equal("report_findings")
		const block = ok(file("extends: reviewer\ntools:\n  - read_file\n  - use_mcp_tool"))
		expect([...block.builtinAllow]).to.deep.equal(["read_file", "use_mcp_tool"])
		expect(capFor({ canCall: () => true, workspaceTrusted: true, parentIsChild: false }, block)!.mcpEnabled).to.equal(true)
		expect(block.reportSchema).to.equal("review")
	})

	it("a file listing run_python under extends: explorer is refused, and the reason names the tool, the base and the rule", () => {
		const reason = refused(file("extends: explorer\ntools: [read_file, run_python]"))
		expect(reason).to.include("tool 'run_python'")
		expect(reason).to.include("'explorer'")
		expect(reason).to.include("A file can only remove tools, never add one")
	})

	it("refuses every tool the base does not hold: writers, commands, the network, completion, spawn, and the exit tool", () => {
		for (const tool of [
			"write_to_file",
			"replace_in_file",
			"execute_command",
			"web_fetch",
			"browser_action",
			"attempt_completion",
			"ask_followup_question",
			"spawn_subagents",
			"run_python",
			"add_claim",
		]) {
			expect(refused(file(`extends: explorer\ntools: [${tool}]`)), tool).to.include(`tool '${tool}'`)
		}
		expect(refused(file("extends: explorer\ntools: [report_findings]"))).to.include("exit tool")
		// the reviewer's exit is report_review, so report_findings is simply not its tool
		expect(refused(file("extends: reviewer\ntools: [report_findings]"))).to.include("tool 'report_findings'")
	})

	it("can lower a budget and never raise one", () => {
		const d = ok(file("extends: explorer\nbudget:\n  maxToolCalls: 10\n  maxCostUsd: 0.5\n  contextStopFraction: 0.5"))
		expect(d.budget).to.deep.equal({
			...EXPLORER_DEFINITION.budget,
			maxToolCalls: 10,
			maxCostUsd: 0.5,
			contextStopFraction: 0.5,
		})
		for (const [key, value] of [
			["maxToolCalls", 31],
			["wallClockMs", 600_001],
			["maxOutputTokens", 40_001],
			["contextStopFraction", 0.81],
			["maxCostUsd", 2.01],
		] as const) {
			const reason = refused(file(`extends: explorer\nbudget:\n  ${key}: ${value}`))
			expect(reason, key).to.include(`budget.${key}`)
			expect(reason, key).to.include("only lower a budget")
		}
		// equal to the base is fine: it adds nothing
		expect(ok(file("extends: explorer\nbudget:\n  maxToolCalls: 30")).budget.maxToolCalls).to.equal(30)
		for (const bad of ["0", "-1", "abc", "1e999", "true"]) {
			expect(refused(file(`extends: explorer\nbudget:\n  maxToolCalls: ${bad}`)), bad).to.include("budget.maxToolCalls")
		}
		expect(refused(file("extends: explorer\nbudget:\n  maxTokens: 5"))).to.include("unknown budget limit")
	})

	it("cannot choose a model or a provider: the model is the user's setting, never a file's", () => {
		for (const line of [
			"model: claude-haiku-4-5",
			"model: some-unpriced-model",
			'model: ""',
			"provider: openai",
			"providerId: openai",
		]) {
			const reason = refused(file(`extends: explorer\n${line}`))
			if (line.startsWith("model")) {
				expect(reason, line).to.equal("model is chosen in settings (agentModels), not in an agent file")
			} else {
				expect(reason, line).to.include("unknown setting")
			}
		}
		// what a file does produce carries no model of its own
		const d = ok(file("extends: reviewer"))
		expect(d.model).to.equal(REVIEWER_DEFINITION.model)
		expect(d.crossProvider).to.equal(REVIEWER_DEFINITION.crossProvider)
		expect(ok(file("extends: explorer")).crossProvider).to.equal(false)
	})

	it("adds prompt text after the role, within a cap, and the text is only text", () => {
		const d = ok(file("extends: explorer", "\nOnly look under src/hydro/.\nReport units.\n\n"))
		expect(d.body).to.equal("Only look under src/hydro/.\nReport units.")
		expect(refused(file("extends: explorer", "x".repeat(AGENT_BODY_MAX_CHARS + 1)))).to.include("the most is")
		expect(ok(file("extends: explorer", "x".repeat(AGENT_BODY_MAX_CHARS))).body).to.have.length(AGENT_BODY_MAX_CHARS)
	})

	it("refuses every setting it does not know, naming it, including each one that would add a power", () => {
		for (const key of [
			"mcp",
			"mcpPolicy",
			"mcp_tools",
			"allow",
			"allowedTools",
			"builtinAllow",
			"autoApprove",
			"autoApproveCeiling",
			"canSpawn",
			"reportSchema",
			"reportTool",
			"isolation",
			"background",
			"provider",
			"source",
			"sha256",
			"limits",
			"crossProvider",
			"approve",
			"yolo",
		]) {
			const reason = refused(file(`extends: explorer\n${key}: true`))
			expect(reason, key).to.include(`unknown setting '${key}'`)
			expect(reason, key).to.include("cannot add tools, MCP access, a budget, a provider")
		}
	})

	it("extends is required and must name a built-in: not a file, not nothing", () => {
		expect(refused(file("description: x"))).to.include("'extends' is required")
		expect(refused(file("extends: general"))).to.include("not a built-in")
		expect(refused(file("extends: my-agent"))).to.include("not a built-in")
		expect(refused(file("extends:\n  - explorer"))).to.include("'extends' is required")
	})

	it("an id is a lowercase hyphenated word list, defaults to the file name, and is never a built-in's", () => {
		expect(ok(file("extends: explorer\nid: other-name")).id).to.equal("other-name")
		expect(ok(file("extends: explorer"), "from-file-name").id).to.equal("from-file-name")
		expect(refused(file("extends: explorer\nid: explorer"))).to.include("built-in agent and cannot be redefined")
		expect(refused(file("extends: explorer"), "reviewer")).to.include("built-in agent and cannot be redefined")
		expect(refused(file("extends: explorer\nid: Bad_Id"))).to.include("'id' must be")
		expect(refused(file("extends: explorer"), "Has Spaces")).to.include("not a valid agent id")
		expect(refused(file("extends: explorer\nid: ../x"))).to.include("'id' must be")
	})

	it("name and description are bounded text", () => {
		expect(ok(file("extends: explorer\nname: Hydro explorer")).displayName).to.equal("Hydro explorer")
		expect(refused(file("extends: explorer\nname: <b>x</b>"))).to.include("'name'")
		expect(refused(file(`extends: explorer\nname: ${"x".repeat(31)}`))).to.include("'name'")
		expect(ok(file("extends: explorer\ndescription: Looks only at src.")).description).to.equal("Looks only at src.")
		expect(refused(file(`extends: explorer\ndescription: ${"x".repeat(301)}`))).to.include("'description'")
	})

	it("narrowing holds for any mix of allowed settings (a seeded property check) and fails for any widened copy", () => {
		let seed = 20261102
		const next = () => {
			seed = (seed * 1664525 + 1013904223) % 4294967296
			return seed / 4294967296
		}
		for (const base of BUILTIN_DEFINITIONS.values()) {
			for (let i = 0; i < 200; i++) {
				const tools = base.builtinAllow.filter(() => next() < 0.6)
				const lines = [`extends: ${base.id}`]
				if (next() < 0.7) lines.push(`tools: [${tools.join(", ")}]`)
				const budget: string[] = []
				for (const [key, limit] of Object.entries(base.budget)) {
					if (next() < 0.5) {
						const lowered = Math.max(0.01, Math.round(limit * next() * 100) / 100)
						budget.push(`  ${key}: ${lowered}`)
					}
				}
				if (budget.length) lines.push(`budget:\n${budget.join("\n")}`)
				const d = ok(file(lines.join("\n")), `gen-${i}`)
				assertNarrower(base, d)
				expect(d.builtinAllow.every((t) => base.builtinAllow.includes(t))).to.equal(true)
			}
		}
		// the check itself: a copy that widens anything is caught
		const wide = (patch: object) => () =>
			assertNarrower(EXPLORER_DEFINITION, { ...ok(file("extends: explorer")), ...patch } as any)
		expect(wide({ builtinAllow: [...EXPLORER_DEFINITION.builtinAllow, "execute_command"] })).to.throw("adds tool")
		expect(wide({ budget: { ...EXPLORER_DEFINITION.budget, maxToolCalls: 99 } })).to.throw("raises maxToolCalls")
		expect(wide({ mcpPolicy: "delegable" })).to.throw("mcpPolicy")
		expect(wide({ autoApproveCeiling: "write" })).to.throw("autoApproveCeiling")
		expect(wide({ canSpawn: true })).to.throw("canSpawn")
		expect(wide({ reportSchema: "review" })).to.throw("reportSchema")
		expect(wide({ crossProvider: true })).to.throw("crossProvider")
		expect(wide({ source: "builtin" })).to.throw("source")
	})
})

describe("agent files: the file format", () => {
	it("reads comments, quotes, inline and block lists, and one nested map", () => {
		const map = parseFrontMatter([
			"# a full-line comment",
			"extends: explorer   # a trailing comment",
			'name: "Hydro # one"',
			"tools: [read_file, 'search_files']",
			"budget:",
			"  maxToolCalls: 12",
			"  maxCostUsd: 0.25",
		])
		expect(map).to.deep.equal({
			extends: "explorer",
			name: "Hydro # one",
			tools: ["read_file", "search_files"],
			budget: { maxToolCalls: 12, maxCostUsd: 0.25 },
		})
	})

	it("refuses what it does not parse, with the line named", () => {
		for (const [front, expected] of [
			["extends: explorer\nextends: reviewer", "'extends' is given twice"],
			["extends: explorer\n  tools: x", "unexpected indentation"],
			["just words", "not a 'key: value' line"],
			["extends: &a explorer", "unsupported YAML"],
			["extends: explorer\ndescription: |\n  block", "unsupported YAML"],
			["extends: explorer\ntools: [read_file", "an inline list must close"],
			["extends: explorer\ntools:", "has no value"],
			["extends: explorer\nbudget:\n  maxToolCalls: 1\n  maxToolCalls: 2", "is given twice"],
			["extends: explorer\ntools:\n  - a\n  b: 1", "must be a list or a map"],
		] as const) {
			expect(refused(file(front)), front).to.include(expected)
		}
	})

	it("hashes the file's bytes and refuses text that is not valid UTF-8", () => {
		const bytes = Buffer.from(file("extends: explorer", "Look at caf\u00e9 only."), "utf8")
		const parsed = parseAgentFile(bytes, ctx())
		expect(parsed.ok && parsed.definition.sha256).to.equal(createHash("sha256").update(bytes).digest("hex"))
		const bad = Buffer.concat([Buffer.from("---\nextends: explorer\n---\nbody "), Buffer.from([0xff, 0xfe, 0xfd])])
		const reason = parseAgentFile(bad, ctx())
		expect(reason.ok).to.equal(false)
		expect(!reason.ok && reason.reason).to.include("not valid UTF-8")
		// a BOM is part of the bytes that were hashed, even though it is not part of the text
		const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("---\nextends: explorer\n---\n")])
		const bomParsed = parseAgentFile(withBom, ctx())
		expect(bomParsed.ok && bomParsed.definition.sha256).to.equal(createHash("sha256").update(withBom).digest("hex"))
	})

	it("needs the opening and closing --- lines", () => {
		expect(refused("extends: explorer")).to.include("must start with a '---' line")
		expect(refused("---\nextends: explorer\n")).to.include("is not closed")
		expect(refused("---\nextends: explorer\n---text")).to.include("must be on its own line")
		expect(splitFile("\uFEFF---\r\nextends: explorer\r\n---\r\nbody\r\n").body).to.equal("body\n")
	})
})

describe("agent files: loading", () => {
	let dir: string
	let home: string
	let ws: string
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "aihydro-agents-"))
		home = path.join(dir, "Documents", "AI-Hydro", "Agents")
		ws = path.join(dir, "repo")
		fs.mkdirSync(home, { recursive: true })
		fs.mkdirSync(workspaceAgentsDir(ws), { recursive: true })
	})
	afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

	const put = (where: string, name: string, text: string) => fs.writeFileSync(path.join(where, name), text)

	it("loads the global folder, then the workspace's, each by file name", async () => {
		put(home, "b-global.md", file("extends: explorer"))
		put(home, "a-global.md", file("extends: reviewer"))
		put(workspaceAgentsDir(ws), "repo-agent.md", file("extends: explorer\ntools: [read_file]"))
		const registry = await loadAgentRegistry({ globalDir: home, workspaceRoots: [ws], workspaceTrusted: true })
		expect([...registry.definitions.keys()]).to.deep.equal(["a-global", "b-global", "repo-agent"])
		expect(registry.definitions.get("a-global")!.source).to.equal("global")
		expect(registry.definitions.get("repo-agent")!.source).to.equal("workspace")
		expect(registry.problems).to.deep.equal([])
		expect(registry.notes).to.deep.equal([])
		// the sha256 is of the file's bytes
		expect(registry.definitions.get("repo-agent")!.sha256).to.equal(
			sha256Hex(fs.readFileSync(path.join(workspaceAgentsDir(ws), "repo-agent.md"), "utf8")),
		)
	})

	it("in an untrusted workspace its files are not opened, nothing from them loads, and the user is told how many were left out", async () => {
		put(home, "mine.md", file("extends: explorer"))
		put(workspaceAgentsDir(ws), "one.md", file("extends: explorer"))
		put(workspaceAgentsDir(ws), "two.md", "this would not even parse")
		put(workspaceAgentsDir(ws), "notes.txt", "not an agent file")
		const registry = await loadAgentRegistry({ globalDir: home, workspaceRoots: [ws], workspaceTrusted: false })
		expect([...registry.definitions.keys()]).to.deep.equal(["mine"])
		expect(registry.problems, "untrusted files are not parsed, so they cannot even be a problem").to.deep.equal([])
		expect(registry.notes).to.have.length(1)
		expect(registry.notes[0]).to.include("2 agent files")
		expect(registry.notes[0]).to.include("not trusted")
		expect(registry.notes[0]).to.include(workspaceAgentsDir(ws))
	})

	it("the same file loads when the workspace is trusted and does not when it is not", async () => {
		const sameFile = file("extends: explorer\ntools: [read_file]", "Look at src only.")
		put(workspaceAgentsDir(ws), "scoped.md", sameFile)
		const trusted = await loadAgentRegistry({ workspaceRoots: [ws], workspaceTrusted: true })
		const untrusted = await loadAgentRegistry({ workspaceRoots: [ws], workspaceTrusted: false })
		expect(trusted.definitions.has("scoped")).to.equal(true)
		expect(untrusted.definitions.has("scoped")).to.equal(false)
		expect(untrusted.notes[0]).to.include("1 agent file")
	})

	it("an invalid file is a problem with its path, id and reason, and the good files still load", async () => {
		put(home, "good.md", file("extends: explorer"))
		put(home, "bad.md", file("extends: explorer\ntools: [run_python]"))
		put(home, "worse.md", "no front matter")
		const registry = await loadAgentRegistry({ globalDir: home, workspaceRoots: [], workspaceTrusted: true })
		expect([...registry.definitions.keys()]).to.deep.equal(["good"])
		expect(registry.problems.map((p) => [p.id, path.basename(p.path)])).to.deep.equal([
			["bad", "bad.md"],
			["worse", "worse.md"],
		])
		expect(registry.problems[0].reason).to.include("run_python")
		expect(registry.problems[0].source).to.equal("global")
	})

	it("a workspace file cannot take over an id the user's global folder defined, and two files never share an id", async () => {
		put(home, "shared.md", file("extends: reviewer\ntools: [read_file]"))
		put(workspaceAgentsDir(ws), "shared.md", file("extends: explorer"))
		put(workspaceAgentsDir(ws), "alias.md", file("extends: explorer\nid: shared"))
		const registry = await loadAgentRegistry({ globalDir: home, workspaceRoots: [ws], workspaceTrusted: true })
		const shared = registry.definitions.get("shared")!
		expect(shared.source).to.equal("global")
		expect(shared.extends).to.equal("reviewer")
		expect(registry.problems).to.have.length(2)
		for (const problem of registry.problems) {
			expect(problem.reason).to.include("already defined by")
		}
	})

	it("refuses a symbolic link, a file that is too large, a folder with too many, and an agents folder that points out of the repository", async () => {
		const outside = path.join(dir, "elsewhere.md")
		fs.writeFileSync(outside, file("extends: explorer"))
		fs.symlinkSync(outside, path.join(home, "link.md"))
		put(home, "big.md", `${file("extends: explorer")}${"x".repeat(AGENT_FILE_MAX_BYTES)}`)
		const registry = await loadAgentRegistry({ globalDir: home, workspaceRoots: [], workspaceTrusted: true })
		expect(registry.definitions.size).to.equal(0)
		expect(registry.problems.map((p) => p.reason).join("\n")).to.include("symbolic link")
		expect(registry.problems.map((p) => p.reason).join("\n")).to.include(`the most is ${AGENT_FILE_MAX_BYTES}`)

		const many = path.join(dir, "many")
		fs.mkdirSync(many)
		for (let i = 0; i < AGENT_FILES_PER_DIR + 2; i++) {
			put(many, `a${String(i).padStart(3, "0")}.md`, file("extends: explorer"))
		}
		const crowded = await loadAgentRegistry({ globalDir: many, workspaceRoots: [], workspaceTrusted: true })
		expect(crowded.definitions.size).to.equal(AGENT_FILES_PER_DIR)
		expect(crowded.problems).to.have.length(2)
		expect(crowded.problems[0].reason).to.include("at most")

		const escaped = path.join(dir, "escaped-repo")
		fs.mkdirSync(path.join(escaped, ".aihydrorules"), { recursive: true })
		const target = path.join(dir, "outside-agents")
		fs.mkdirSync(target)
		put(target, "x.md", file("extends: explorer"))
		fs.symlinkSync(target, workspaceAgentsDir(escaped))
		const out = await loadAgentRegistry({ workspaceRoots: [escaped], workspaceTrusted: true })
		expect(out.definitions.size).to.equal(0)
		expect(out.problems[0].reason).to.include("outside the workspace")
	})

	it("a file that is not valid UTF-8 is a problem, and a long reason is cut before it reaches anyone", async () => {
		fs.writeFileSync(path.join(home, "binary.md"), Buffer.from([0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0xfe]))
		put(home, "long.md", file(`extends: explorer\n${"x".repeat(5000)}: 1`))
		const registry = await loadAgentRegistry({ globalDir: home, workspaceRoots: [], workspaceTrusted: true })
		const byId = Object.fromEntries(registry.problems.map((p) => [p.id, p.reason]))
		expect(byId.binary).to.include("not valid UTF-8")
		expect(byId.long.length).to.be.at.most(MAX_PROBLEM_REASON_CHARS)
		expect(byId.long.endsWith("…")).to.equal(true)
		expect(byId.long).to.include("unknown setting")
	})

	it("missing folders and no folders at all are not problems", async () => {
		const registry = await loadAgentRegistry({
			globalDir: path.join(dir, "nope"),
			workspaceRoots: [path.join(dir, "no-repo")],
			workspaceTrusted: true,
		})
		expect(registry.definitions.size).to.equal(0)
		expect(registry.problems).to.deep.equal([])
		expect((await loadAgentRegistry({ workspaceRoots: [], workspaceTrusted: false })).notes).to.deep.equal([])
	})
})

describe("agent files: protected paths", () => {
	it("the workspace agents folder and the global Agents folder are protected, so an agent cannot edit them without asking", () => {
		const home = "/Users/x/Documents/AI-Hydro/Agents"
		const roots = [home]
		expect(isProtectedPath("/repo/.aihydrorules/agents/mine.md", [])).to.equal(true)
		expect(isProtectedPath("/repo/.aihydrorules/agents", [])).to.equal(true)
		expect(isProtectedPath("/repo/sub/.aihydrorules/agents/x/y.md", [])).to.equal(true)
		expect(isProtectedPath("C:\\repo\\.aihydrorules\\agents\\mine.md", [])).to.equal(true)
		expect(isProtectedPath("/repo/.AIHYDRORULES/Agents/mine.md", [])).to.equal(true)
		expect(isProtectedPath(`${home}/mine.md`, roots)).to.equal(true)
		// the rest of the rules folder is not protected by this change
		expect(isProtectedPath("/repo/.aihydrorules/rules.md", [])).to.equal(false)
		expect(isProtectedPath("/repo/.aihydrorules/agents-notes.md", [])).to.equal(false)
		expect(isProtectedPath("/repo/src/agents/mine.md", [])).to.equal(false)
	})

	it("the default global folder is always a protected root, and the host's resolved one when known", () => {
		const home = path.join(os.tmpdir(), "aihydro-agents-home")
		const roots = computeProtectedRoots({
			homeDir: home,
			agentsDir: path.join(home, "OneDrive", "Documents", "AI-Hydro", "Agents"),
		})
		expect(roots).to.include(path.join(home, "Documents", "AI-Hydro", "Agents"))
		expect(isProtectedPath(path.join(home, "Documents", "AI-Hydro", "Agents", "mine.md"), roots)).to.equal(true)
		expect(isProtectedPath(path.join(home, "OneDrive", "Documents", "AI-Hydro", "Agents", "mine.md"), roots)).to.equal(true)
		expect(isProtectedPath(path.join(home, "Documents", "AI-Hydro", "Rules", "mine.md"), roots)).to.equal(false)
	})

	it("a command that names a workspace agent file always asks", () => {
		expect(commandMentionsProtectedPath("echo hi > .aihydrorules/agents/mine.md")).to.equal(true)
		expect(commandMentionsProtectedPath("cat .aihydrorules/rules.md")).to.equal(false)
	})
})

describe("agent files: hash in the record, the lead's result and so the export", () => {
	const usage = { toolCalls: 1, turns: 1, tokensIn: 1, tokensOut: 1, cacheWrites: 0, cacheReads: 0 }
	const base = {
		childId: "sa_1",
		label: "Scoped 1",
		status: "completed" as const,
		report: { summary: "s", keyFindings: [], filesRead: [], openQuestions: [] },
		usage,
	}

	it("a user file's id, source and sha256 are attributes of its report block; a built-in adds none", () => {
		const sha = "a".repeat(64)
		const text = formatReportsForParent([{ ...base, definition: { id: "scoped", source: "workspace", sha256: sha } }])
		expect(text).to.include(
			`<subagent id="sa_1" label="Scoped 1" status="completed" definition="scoped" source="workspace" sha256="${sha}"`,
		)
		const builtin = formatReportsForParent([{ ...base, definition: { id: "explorer", source: "builtin", sha256: sha } }])
		expect(builtin).to.not.include("sha256=")
		expect(builtin).to.not.include("definition=")
		expect(formatReportsForParent([base])).to.not.include("sha256=")
	})

	it("an id cannot break out of its attribute", () => {
		const text = formatReportsForParent([
			{ ...base, definition: { id: 'x" onload="y<', source: "global", sha256: "b".repeat(64) } },
		])
		expect(text).to.not.include('onload="y<')
		expect(text).to.include("&lt;")
	})
})
