import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { atomicWriteFile } from "../atomicWrite"
import { readMcpSettings } from "../launcherRegistration"
import { acquireLock, runProcess, scrubbedEnv } from "../nodeDeps"

describe("tools environment process helpers", () => {
	let dir: string
	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "nd-"))
	})
	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	it("scrubs PYTHONPATH and PYTHONHOME (any case) and keeps the rest", () => {
		const env = scrubbedEnv({ PYTHONPATH: "/x", pythonhome: "/y", PATH: "/bin", KEEP: "1" })
		expect(env).to.deep.equal({ PATH: "/bin", KEEP: "1" })
	})

	it("children do not see the caller's PYTHONPATH", async () => {
		process.env.PYTHONPATH = "/should/not/leak"
		try {
			const r = await runProcess(process.execPath, ["-e", "process.stdout.write(String(process.env.PYTHONPATH))"])
			expect(r.stdout).to.equal("undefined")
		} finally {
			delete process.env.PYTHONPATH
		}
	})

	it("a timed-out child is killed and reported as timed out", async () => {
		const r = await runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 200 })
		expect(r.timedOut).to.equal(true)
		expect(r.exitCode).to.equal(null)
	})

	it("O_EXCL lock: a second holder is refused, release frees it, a dead pid is taken over", async () => {
		const lock = path.join(dir, "venv", ".install.lock")
		const a = await acquireLock(lock)
		expect(a.ok).to.equal(true)
		await fs.writeFile(lock, String(process.ppid)) // another live process (our parent)
		const b = await acquireLock(lock)
		expect(b.ok).to.equal(false)
		await fs.writeFile(lock, "2147483646") // no such pid
		const c = await acquireLock(lock)
		expect(c.ok).to.equal(true)
		if (c.ok) {
			await c.release()
		}
		await fs.stat(lock).then(
			() => expect.fail("lock should be gone"),
			() => undefined,
		)
	})

	it("atomic write leaves no temp files and replaces the content", async () => {
		const f = path.join(dir, "a.json")
		await atomicWriteFile(f, "1")
		await atomicWriteFile(f, "2")
		expect(await fs.readFile(f, "utf-8")).to.equal("2")
		expect(await fs.readdir(dir)).to.deep.equal(["a.json"])
	})

	it("settings reader retries once on a parse error (a writer mid-rename)", async () => {
		const f = path.join(dir, "s.json")
		await fs.writeFile(f, "{ half")
		setTimeout(() => void fs.writeFile(f, JSON.stringify({ mcpServers: { x: {} } })), 40)
		const r = await readMcpSettings(f)
		expect(r.ok).to.equal(true)
	})
})
