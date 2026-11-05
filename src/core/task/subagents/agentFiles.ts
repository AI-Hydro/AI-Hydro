import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { SubagentBudget, SubagentProfileId } from "@shared/aihydro/subagents"
import { isAgentId } from "@shared/aihydro/subagents"
import { AiHydroDefaultTool } from "@/shared/tools"
import { type AgentDefinition, BUILTIN_DEFINITIONS, reportToolFor } from "./agentDefinition"

/**
 * User-defined agents (orchestration report 5.1 and Stage 3; owner decision D8). A file defines a NARROWER variant of a
 * built-in: it names the built-in it extends, and it can remove tools, add prompt text and lower budgets. It can never add
 * a tool, MCP access or a budget, change the report schema, the MCP policy, the auto-approve ceiling or `canSpawn`, and
 * it cannot choose a model or a provider: a model can be unpriced (so no dollar cap would fire) or, on a gateway
 * provider, belong to another vendor, so the model is chosen only in the user's `agentModels` setting (D7). That is by
 * construction, not by checking: a derived definition is the base with only the tool list, budget, name, description and
 * prompt text replaced, and `assertNarrower` repeats the comparison so a later edit that copies another field fails a
 * test.
 *
 * Where files live, in order: the built-ins, then the user's global `Agents` folder (beside `Rules`), then each
 * workspace's `.aihydrorules/agents/*.md`. A workspace file loads only in a trusted workspace (a workspace file is
 * prompt text anyone who can write into the repository controls); in an untrusted one it is not read, and the user is
 * told how many were left out. An invalid file is reported with its reason; nothing is skipped silently. Two files never
 * share an id, and no file may use a built-in's id, so a repository cannot replace an agent the user already relies on.
 *
 * The file is a YAML subset between `---` lines, then prompt text. The subset is small on purpose and parsed here (no
 * YAML library is loaded): scalars, inline lists, block lists, and one nested map for `budget`. Anything else is refused.
 */

/** Largest file read, in bytes. */
export const AGENT_FILE_MAX_BYTES = 16 * 1024
/** Longest body (the added prompt text), in characters. */
export const AGENT_BODY_MAX_CHARS = 4_000
/** Most files read from one folder. */
export const AGENT_FILES_PER_DIR = 50

export type AgentFileSource = "global" | "workspace"

/** A file that did not load, and why. Shown to the user; never hidden. */
export interface AgentFileProblem {
	source: AgentFileSource
	/** Absolute path of the file. */
	path: string
	/** The id the file would have had (its `id`, else its name), so a request for it can be answered with the reason. */
	id: string
	reason: string
}

/** Longest problem reason that reaches the card or the lead's tool error. */
export const MAX_PROBLEM_REASON_CHARS = 200

export function capReason(reason: string): string {
	const oneLine = reason.replace(/\s+/g, " ").trim()
	return oneLine.length > MAX_PROBLEM_REASON_CHARS ? `${oneLine.slice(0, MAX_PROBLEM_REASON_CHARS - 1)}…` : oneLine
}

export interface AgentRegistry {
	/** File definitions that loaded, by id. Built-ins are not in it. */
	definitions: ReadonlyMap<SubagentProfileId, AgentDefinition>
	problems: readonly AgentFileProblem[]
	/** Things the user should know that are not a file's fault, such as workspace files left out of an untrusted workspace. */
	notes: readonly string[]
}

export const EMPTY_AGENT_REGISTRY: AgentRegistry = { definitions: new Map(), problems: [], notes: [] }

const ALLOWED_KEYS = ["id", "name", "extends", "description", "tools", "budget"] as const
const BUDGET_KEYS: ReadonlyArray<keyof SubagentBudget> = [
	"maxToolCalls",
	"wallClockMs",
	"maxOutputTokens",
	"contextStopFraction",
	"maxCostUsd",
]

// ---- the YAML subset ----

type Scalar = string | number | boolean
type Value = Scalar | Scalar[] | { [key: string]: Scalar }

class FileError extends Error {}

function unquote(raw: string): Scalar {
	const text = raw.trim()
	if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
		return text.slice(1, -1)
	}
	if (/^-?\d+(?:\.\d+)?$/.test(text)) {
		return Number(text)
	}
	if (text === "true" || text === "false") {
		return text === "true"
	}
	if (/^[|>&*!%@`]/.test(text)) {
		throw new FileError(
			`unsupported YAML in '${text.slice(0, 20)}' (block scalars, anchors, tags and aliases are not allowed)`,
		)
	}
	return text
}

/** A trailing ` # comment` on an unquoted value is dropped. A `#` inside quotes is kept. */
function stripComment(line: string): string {
	let quote: string | undefined
	for (let i = 0; i < line.length; i++) {
		const ch = line[i]
		if (quote) {
			if (ch === quote) {
				quote = undefined
			}
		} else if (ch === '"' || ch === "'") {
			quote = ch
		} else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
			return line.slice(0, i)
		}
	}
	return line
}

function parseInlineList(raw: string): Scalar[] {
	const inner = raw.trim().slice(1, -1).trim()
	if (!inner) {
		return []
	}
	return inner.split(",").map((part) => unquote(part))
}

/** Parse the front matter lines into a map. Strict: a duplicate key, odd indentation or an unknown shape is an error. */
export function parseFrontMatter(lines: string[]): Record<string, Value> {
	const out: Record<string, Value> = {}
	let i = 0
	while (i < lines.length) {
		const line = stripComment(lines[i]).replace(/\s+$/, "")
		i++
		if (!line.trim()) {
			continue
		}
		if (/^\s/.test(line)) {
			throw new FileError(`unexpected indentation: '${line.trim().slice(0, 40)}'`)
		}
		const match = /^([A-Za-z][A-Za-z0-9_]*):(?:\s+(.*))?$/.exec(line)
		if (!match) {
			throw new FileError(`not a 'key: value' line: '${line.slice(0, 40)}'`)
		}
		const [, key, rest] = match
		if (Object.hasOwn(out, key)) {
			throw new FileError(`'${key}' is given twice`)
		}
		const value = (rest ?? "").trim()
		if (value) {
			out[key] = value.startsWith("[")
				? value.endsWith("]")
					? parseInlineList(value)
					: (() => {
							throw new FileError(`'${key}': an inline list must close on the same line`)
						})()
				: unquote(value)
			continue
		}
		// a block under the key: a list of "- item" lines, or a map of indented "name: value" lines
		const block: string[] = []
		while (i < lines.length) {
			const next = stripComment(lines[i]).replace(/\s+$/, "")
			if (!next.trim()) {
				i++
				continue
			}
			if (!/^\s/.test(next)) {
				break
			}
			block.push(next.trim())
			i++
		}
		if (block.length === 0) {
			throw new FileError(`'${key}' has no value`)
		}
		if (block.every((item) => item.startsWith("- ") || item === "-")) {
			out[key] = block.map((item) => unquote(item.slice(1)))
		} else if (block.every((item) => /^[A-Za-z][A-Za-z0-9_]*:\s+\S/.test(item))) {
			const map: { [key: string]: Scalar } = {}
			for (const item of block) {
				const [, k, v] = /^([A-Za-z][A-Za-z0-9_]*):\s+(.*)$/.exec(item)!
				if (Object.hasOwn(map, k)) {
					throw new FileError(`'${key}.${k}' is given twice`)
				}
				map[k] = unquote(v)
			}
			out[key] = map
		} else {
			throw new FileError(`'${key}' must be a list or a map of simple values`)
		}
	}
	return out
}

/** Split a file into its front matter lines and its body. A file must open with a `---` line and close the block. */
export function splitFile(raw: string): { front: string[]; body: string } {
	const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n")
	if (!text.startsWith("---\n")) {
		throw new FileError("must start with a '---' line, then the settings, then another '---' line")
	}
	const close = text.indexOf("\n---", 3)
	if (close < 0) {
		throw new FileError("the settings block is not closed with a '---' line")
	}
	const after = text.slice(close + 4)
	if (after !== "" && !after.startsWith("\n")) {
		throw new FileError("the closing '---' must be on its own line")
	}
	return { front: text.slice(4, close).split("\n"), body: after.replace(/^\n/, "") }
}

// ---- narrowing ----

function titleCase(id: string): string {
	const words = id.replace(/-/g, " ")
	return words.charAt(0).toUpperCase() + words.slice(1)
}

function isNumberAbove0(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0
}

/**
 * Throws if `derived` is not the base with fewer tools, lower budgets, more prompt text. This repeats, as a
 * check, what building the definition from the base already guarantees.
 */
export function assertNarrower(base: AgentDefinition, derived: AgentDefinition): void {
	const fail = (what: string) => {
		throw new Error(`not narrower than '${base.id}': ${what}`)
	}
	if (derived.source === "builtin") {
		fail("source")
	}
	for (const tool of derived.builtinAllow) {
		if (!base.builtinAllow.includes(tool)) {
			fail(`adds tool ${tool}`)
		}
	}
	for (const key of BUDGET_KEYS) {
		if (derived.budget[key] > base.budget[key]) {
			fail(`raises ${key}`)
		}
	}
	if (derived.mcpPolicy !== base.mcpPolicy) fail("mcpPolicy")
	if (derived.reportSchema !== base.reportSchema) fail("reportSchema")
	if (derived.autoApproveCeiling !== base.autoApproveCeiling) fail("autoApproveCeiling")
	if (derived.canSpawn !== false) fail("canSpawn")
	if (derived.crossProvider && !base.crossProvider) fail("crossProvider")
	if (derived.model !== base.model) fail("model policy")
	if (derived.limits !== base.limits || derived.advisory !== base.advisory) fail("limits")
	if (reportToolFor(derived.reportSchema) !== reportToolFor(base.reportSchema)) fail("exit tool")
}

/** The tools a file may name, for the error text. */
function toolNames(base: AgentDefinition): string {
	return base.builtinAllow.join(", ")
}

/**
 * Build a definition from a file's text, or say why not. `stem` is the file name without `.md`; it is the id when the file
 * gives none. Returns the id the file would have had even on failure, so a request for it can be answered.
 */
export function parseAgentFile(
	bytes: Uint8Array | string,
	ctx: { path: string; source: AgentFileSource; stem: string },
): { ok: true; definition: AgentDefinition } | { ok: false; reason: string; id: string } {
	let id = ctx.stem
	try {
		// The hash is of the file's bytes, as read. Text that is not valid UTF-8 is refused rather than decoded loosely, so
		// the text that runs and the bytes that were hashed cannot differ.
		const buffer = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes)
		let raw: string
		try {
			raw = new TextDecoder("utf-8", { fatal: true }).decode(buffer)
		} catch {
			throw new FileError("the file is not valid UTF-8 text")
		}
		const { front, body } = splitFile(raw)
		const map = parseFrontMatter(front)
		if (typeof map.id === "string" && isAgentId(map.id)) {
			id = map.id
		}
		if (Object.hasOwn(map, "model")) {
			// A model can be unpriced (so no dollar cap would fire) or, on a gateway provider, belong to another vendor.
			// The user chooses it in settings (D7), where the card and the cost caps account for it.
			throw new FileError("model is chosen in settings (agentModels), not in an agent file")
		}
		for (const key of Object.keys(map)) {
			if (!(ALLOWED_KEYS as readonly string[]).includes(key)) {
				throw new FileError(
					`unknown setting '${key}'. A file may set only ${ALLOWED_KEYS.join(", ")}; it cannot add tools, MCP access, a budget, a provider or any other power`,
				)
			}
		}

		// extends: required, and only a built-in (no chains, so there is one base to compare against)
		if (typeof map.extends !== "string" || !map.extends) {
			throw new FileError(
				`'extends' is required: the built-in this agent narrows (${[...BUILTIN_DEFINITIONS.keys()].join(", ")})`,
			)
		}
		const base = BUILTIN_DEFINITIONS.get(map.extends)
		if (!base) {
			throw new FileError(
				`'extends: ${map.extends}' is not a built-in agent (${[...BUILTIN_DEFINITIONS.keys()].join(", ")})`,
			)
		}

		if (map.id !== undefined && (typeof map.id !== "string" || !isAgentId(map.id))) {
			throw new FileError("'id' must be lowercase words joined by hyphens, at most 40 characters")
		}
		if (!isAgentId(id)) {
			throw new FileError(
				`the file name '${ctx.stem}' is not a valid agent id (lowercase words joined by hyphens); name the file so, or set 'id'`,
			)
		}
		if (BUILTIN_DEFINITIONS.has(id)) {
			throw new FileError(`'${id}' is a built-in agent and cannot be redefined; give this one another id`)
		}

		// name
		let displayName = titleCase(id)
		if (map.name !== undefined) {
			if (typeof map.name !== "string" || !/^[A-Za-z][A-Za-z0-9 ]{0,29}$/.test(map.name)) {
				throw new FileError("'name' must be letters, digits and spaces, starting with a letter, at most 30 characters")
			}
			displayName = map.name
		}

		// description
		let description = base.description
		if (map.description !== undefined) {
			if (typeof map.description !== "string" || map.description.length > 300) {
				throw new FileError("'description' must be text of at most 300 characters")
			}
			description = map.description
		}

		// tools: a subset of the base's. Removal only.
		let builtinAllow: readonly AiHydroDefaultTool[] = base.builtinAllow
		if (map.tools !== undefined) {
			if (!Array.isArray(map.tools) || map.tools.some((tool) => typeof tool !== "string")) {
				throw new FileError("'tools' must be a list of tool names")
			}
			const wanted = new Set<string>()
			for (const tool of map.tools as string[]) {
				if (tool === reportToolFor(base.reportSchema)) {
					throw new FileError(`'${tool}' is the exit tool of '${base.id}'; it is always present and is not listed`)
				}
				if (!(base.builtinAllow as readonly string[]).includes(tool)) {
					throw new FileError(
						`tool '${tool}' is not one of the tools of '${base.id}' (${toolNames(base)}). A file can only remove tools, never add one`,
					)
				}
				wanted.add(tool)
			}
			builtinAllow = base.builtinAllow.filter((tool) => wanted.has(tool))
		}

		// budget: each value at or below the base's
		const budget: SubagentBudget = { ...base.budget }
		if (map.budget !== undefined) {
			if (typeof map.budget !== "object" || Array.isArray(map.budget)) {
				throw new FileError("'budget' must be a map of limits")
			}
			for (const [key, value] of Object.entries(map.budget)) {
				if (!(BUDGET_KEYS as readonly string[]).includes(key)) {
					throw new FileError(`unknown budget limit '${key}' (${BUDGET_KEYS.join(", ")})`)
				}
				const limit = key as keyof SubagentBudget
				if (!isNumberAbove0(value)) {
					throw new FileError(`budget.${key} must be a number above 0`)
				}
				if (value > base.budget[limit]) {
					throw new FileError(
						`budget.${key} is ${value}, above the ${base.budget[limit]} of '${base.id}'. A file can only lower a budget, never raise it`,
					)
				}
				budget[limit] = value
			}
		}

		// body: the added prompt text
		const bodyText = body.trim()
		if (bodyText.length > AGENT_BODY_MAX_CHARS) {
			throw new FileError(`the prompt text is ${bodyText.length} characters; the most is ${AGENT_BODY_MAX_CHARS}`)
		}

		const definition: AgentDefinition = Object.freeze({
			...base,
			id,
			displayName,
			extends: base.id,
			source: ctx.source,
			sha256: createHash("sha256").update(buffer).digest("hex"),
			path: ctx.path,
			description,
			builtinAllow,
			budget,
			...(bodyText ? { body: bodyText } : {}),
		})
		assertNarrower(base, definition)
		return { ok: true, definition }
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : String(error), id }
	}
}

// ---- loading ----

async function listAgentFiles(dir: string): Promise<{ names: string[]; missing: boolean }> {
	try {
		const entries = await fs.readdir(dir)
		return { names: entries.filter((name) => name.toLowerCase().endsWith(".md")).sort(), missing: false }
	} catch {
		return { names: [], missing: true }
	}
}

export interface LoadAgentsOptions {
	/** The user's global agents folder, or undefined when there is none. */
	globalDir?: string
	/** Workspace roots. Their `.aihydrorules/agents` folders are read only when `workspaceTrusted`. */
	workspaceRoots: readonly string[]
	workspaceTrusted: boolean
}

/** The folder inside a workspace root. */
export function workspaceAgentsDir(root: string): string {
	return path.join(root, ".aihydrorules", "agents")
}

/**
 * Read every agent file. Never throws: a file that cannot be read or parsed becomes a problem. Order: the global folder,
 * then each workspace root; within a folder, by file name. The first definition of an id wins; a later one with the same id
 * is a problem, so a repository cannot take over an id the user's own folder defined.
 */
export async function loadAgentRegistry(options: LoadAgentsOptions): Promise<AgentRegistry> {
	const definitions = new Map<SubagentProfileId, AgentDefinition>()
	const problems: AgentFileProblem[] = []
	const notes: string[] = []

	const readFolder = async (dir: string, source: AgentFileSource, containedIn?: string) => {
		const { names, missing } = await listAgentFiles(dir)
		if (missing) {
			return
		}
		if (containedIn) {
			// A folder that is a symlink out of the repository would let a file from anywhere be read as the repository's.
			try {
				const real = await fs.realpath(dir)
				const root = await fs.realpath(containedIn)
				if (real !== root && !real.startsWith(root + path.sep)) {
					problems.push({
						source,
						path: dir,
						id: "",
						reason: "the agents folder resolves outside the workspace, so it is not read",
					})
					return
				}
			} catch (error) {
				problems.push({ source, path: dir, id: "", reason: `the agents folder cannot be checked: ${String(error)}` })
				return
			}
		}
		for (const [index, name] of names.entries()) {
			const file = path.join(dir, name)
			const stem = name.slice(0, -3)
			if (index >= AGENT_FILES_PER_DIR) {
				problems.push({
					source,
					path: file,
					id: stem,
					reason: `not read: a folder holds at most ${AGENT_FILES_PER_DIR} agent files`,
				})
				continue
			}
			try {
				const stat = await fs.lstat(file)
				if (stat.isSymbolicLink()) {
					problems.push({
						source,
						path: file,
						id: stem,
						reason: "a symbolic link is not followed; put the file here itself",
					})
					continue
				}
				if (!stat.isFile()) {
					problems.push({ source, path: file, id: stem, reason: "not a regular file" })
					continue
				}
				if (stat.size > AGENT_FILE_MAX_BYTES) {
					problems.push({
						source,
						path: file,
						id: stem,
						reason: `${stat.size} bytes; the most is ${AGENT_FILE_MAX_BYTES}`,
					})
					continue
				}
				const bytes = await fs.readFile(file)
				const parsed = parseAgentFile(bytes, { path: file, source, stem })
				if (!parsed.ok) {
					problems.push({ source, path: file, id: parsed.id, reason: parsed.reason })
					continue
				}
				const earlier = definitions.get(parsed.definition.id)
				if (earlier) {
					problems.push({
						source,
						path: file,
						id: parsed.definition.id,
						reason: `the id '${parsed.definition.id}' is already defined by ${earlier.path}; the first one stands`,
					})
					continue
				}
				definitions.set(parsed.definition.id, parsed.definition)
			} catch (error) {
				problems.push({
					source,
					path: file,
					id: stem,
					reason: `cannot be read: ${error instanceof Error ? error.message : String(error)}`,
				})
			}
		}
	}

	if (options.globalDir) {
		await readFolder(options.globalDir, "global")
	}
	for (const root of options.workspaceRoots) {
		const dir = workspaceAgentsDir(root)
		if (!options.workspaceTrusted) {
			// Names only: the files are not opened, so nothing in them is parsed or shown as an instruction.
			const { names } = await listAgentFiles(dir)
			if (names.length > 0) {
				notes.push(
					`${names.length} agent file${names.length === 1 ? "" : "s"} in ${dir} ${names.length === 1 ? "was" : "were"} not loaded: this workspace is not trusted. Trust the workspace to use ${names.length === 1 ? "it" : "them"}.`,
				)
			}
			continue
		}
		await readFolder(dir, "workspace", root)
	}
	// A reason can carry text from the file itself (an unknown setting's name, a line): bounded before it is shown anywhere.
	return { definitions, problems: problems.map((problem) => ({ ...problem, reason: capReason(problem.reason) })), notes }
}
