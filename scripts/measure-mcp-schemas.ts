/**
 * Measure what compact tool schemas save on a real tool listing.
 *
 *   TS_NODE_PROJECT=./tsconfig.unit-test.json npx ts-node scripts/measure-mcp-schemas.ts <tools_list.json>
 *
 * `<tools_list.json>` is an MCP `tools/list` result: an array of `{name, description, inputSchema, _meta}` (for the
 * first-party server, dump it in-process from the tools checkout: `await mcp.list_tools()`). Prints the characters, lines
 * and pre-tokenizer pieces (a cl100k-style split, a proxy: it is not a token count) of the full-schema block of the hot tools
 * as it was rendered before 0.4.6 (indented) and now (`renderSchema`). Dev-only; nothing here ships.
 */
import * as fs from "node:fs"
import { renderSchema } from "../src/core/prompts/system-prompt/components/compactSchema"

const file = process.argv[2]
if (!file) {
	console.error("usage: measure-mcp-schemas.ts <tools_list.json>")
	process.exit(2)
}
const tools: any[] = JSON.parse(fs.readFileSync(file, "utf8"))
const hot = tools.filter((t) => t._meta?.hot === true || t.hot === true)
const set = hot.length > 0 ? hot : tools
const before = set
	.map((t) => `    Input Schema:\n    ${JSON.stringify(t.inputSchema, null, 2).split("\n").join("\n    ")}`)
	.join("\n\n")
const after = set.map((t) => `    Input Schema: ${renderSchema(t.inputSchema)}`).join("\n\n")
const pieces = (s: string) =>
	(
		s.match(
			/'(?:[sdmt]|ll|ve|re)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]|\s+(?!\S)|\s+/giu,
		) ?? []
	).length
const row = (label: string, s: string) =>
	`${label.padEnd(8)} chars ${String(s.length).padStart(7)}  lines ${String(s.split("\n").length).padStart(5)}  pieces ${String(pieces(s)).padStart(6)}`
console.log(`${set.length} tools with full schemas (${hot.length > 0 ? "hot" : "all"})`)
console.log(row("before", before))
console.log(row("after", after))
console.log(`saved ${(100 * (1 - after.length / before.length)).toFixed(1)}% of characters`)
