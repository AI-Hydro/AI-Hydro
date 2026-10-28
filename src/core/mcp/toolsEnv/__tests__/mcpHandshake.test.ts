import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { mcpHandshake } from "../nodeDeps"

/** The handshake is exercised against a tiny stand-in MCP server run by node itself (no pip, no Python). */
describe("mcpHandshake", () => {
	let dir: string
	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "hs-"))
	})
	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})
	const server = async (body: string) => {
		const file = path.join(dir, "server.js")
		await fs.writeFile(file, body)
		return file
	}
	const GOOD = `
let buf = ""
process.stdin.on("data", (d) => {
  buf += d
  let i
  while ((i = buf.indexOf("\\n")) >= 0) {
    const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
    if (msg.method === "initialize") process.stdout.write("banner line, not json\\n" + JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { serverInfo: { name: "fake" }, capabilities: {} } }) + "\\n")
    if (msg.method === "tools/list") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "a" }, { name: "b" }] } }) + "\\n")
  }
})`

	it("completes initialize + tools/list and reports the tool count", async () => {
		const r = await mcpHandshake(process.execPath, [await server(GOOD)], { timeoutMs: 10_000 })
		expect(r).to.deep.include({ ok: true, serverName: "fake", toolCount: 2 })
	})

	it("fails (does not hang) when the server never answers", async () => {
		const r = await mcpHandshake(process.execPath, [await server("setInterval(() => {}, 1000)")], { timeoutMs: 400 })
		expect(r.ok).to.equal(false)
		expect(r.error).to.match(/no response/)
	})

	it("fails with the exit code when the server crashes at start", async () => {
		const r = await mcpHandshake(process.execPath, [await server("console.error('boom'); process.exit(3)")], {
			timeoutMs: 10_000,
		})
		expect(r.ok).to.equal(false)
		expect(r.error).to.match(/exited \(code 3\)/)
	})

	it("fails for a command that does not exist", async () => {
		const r = await mcpHandshake(path.join(dir, "missing"), [], { timeoutMs: 5_000 })
		expect(r.ok).to.equal(false)
	})

	it("stops when cancelled", async () => {
		const ac = new AbortController()
		const p = mcpHandshake(process.execPath, [await server("setInterval(() => {}, 1000)")], {
			timeoutMs: 10_000,
			signal: ac.signal,
		})
		setTimeout(() => ac.abort(), 50)
		expect((await p).error).to.equal("cancelled")
	})
})
