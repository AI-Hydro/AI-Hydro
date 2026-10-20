import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import * as path from "node:path"
import { expect } from "chai"
import { afterEach, describe, it } from "mocha"

// Resolved from the repo root (where mocha runs) rather than from the module's own
// location, so this spec loads under both the CommonJS and ESM unit-test loaders.
const RUNNER = path.resolve(process.cwd(), "src", "services", "artifact-preview", "artifact_kernel_runner.py")
const PYTHON = process.env.AIHYDRO_TEST_PYTHON || process.env.AIHYDRO_E2E_PYTHON || "python3"

type Response = Record<string, any>

/** A live kernel process driven over the real protocol (no mocks). */
class Kernel {
	readonly child: ChildProcessWithoutNullStreams
	readonly stderr: string[] = []
	private readonly waiting = new Map<string, (r: Response) => void>()
	private readonly arrived = new Map<string, Response>()
	readonly order: string[] = []
	private buffer = ""

	constructor(env: Record<string, string> = {}) {
		this.child = spawn(PYTHON, [RUNNER], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env } })
		this.child.stdout.on("data", (chunk: Buffer) => {
			this.buffer += chunk.toString("utf8")
			const parts = this.buffer.split("\n")
			this.buffer = parts.pop() ?? ""
			for (const line of parts) {
				if (!line.trim()) continue
				const response = JSON.parse(line) as Response // a non-JSON line IS the bug under test
				this.order.push(String(response.id))
				const waiter = this.waiting.get(String(response.id))
				if (waiter) {
					this.waiting.delete(String(response.id))
					waiter(response)
				} else {
					this.arrived.set(String(response.id), response)
				}
			}
		})
		this.child.stderr.on("data", (chunk: Buffer) => this.stderr.push(chunk.toString("utf8")))
	}

	send(message: Record<string, unknown>): void {
		this.child.stdin.write(`${JSON.stringify(message)}\n`)
	}

	response(id: string, timeoutMs = 30_000): Promise<Response> {
		const early = this.arrived.get(id)
		if (early) {
			this.arrived.delete(id)
			return Promise.resolve(early)
		}
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`no response for ${id} within ${timeoutMs}ms`)), timeoutMs)
			this.waiting.set(id, (r) => {
				clearTimeout(timer)
				resolve(r)
			})
		})
	}

	async exec(id: string, code: string, timeoutMs?: number): Promise<Response> {
		this.send({ op: "exec", id, code })
		return this.response(id, timeoutMs)
	}

	stop(): void {
		this.child.kill("SIGKILL")
	}
}

// A cold matplotlib import (font cache build on a fresh CI runner) can take longer than a
// single test's response timeout, and every test SIGKILLs its kernel, so the cache would
// never finish. Pay that cost once, here, before any kernel is timed.
function warmPythonImports(python: string): Promise<void> {
	return new Promise((resolve) => {
		execFile(python, ["-c", "import matplotlib.pyplot"], { timeout: 170_000 }, () => resolve())
	})
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("artifact_kernel_runner.py protocol", function () {
	this.timeout(60_000)
	let kernel: Kernel | undefined

	before(async function () {
		if (!existsSync(RUNNER)) {
			this.skip()
		}
		this.timeout(180_000)
		await warmPythonImports(PYTHON)
	})
	afterEach(() => kernel?.stop())

	describe("interrupt", () => {
		it("stops a sleeping cell promptly, keeps variables, and does not leak the protocol into output", async () => {
			kernel = new Kernel()
			await kernel.exec("a", "marker = 41")

			const startedAt = Date.now()
			kernel.send({ op: "exec", id: "sleep", code: "import time\ntime.sleep(5)\nprint('SLEEP_FINISHED_NOT_INTERRUPTED')" })
			await sleep(1000)
			kernel.send({ op: "interrupt", target: "sleep" })
			const result = await kernel.response("sleep")
			const elapsedMs = Date.now() - startedAt

			// Recorded in the PR description: ~1.0-1.3 s (interrupt sent at 1.0 s).
			console.log(`      [interrupt timing] 5 s sleep interrupted at 1.0 s; cell ended after ${elapsedMs} ms`)
			expect(elapsedMs).to.be.lessThan(1500)
			expect(result.status).to.equal("interrupted")
			expect(result.error).to.include("KeyboardInterrupt")
			expect(result.stdout).to.not.include("SLEEP_FINISHED")
			expect(result.stdout).to.not.include("interrupted") // the old handler's JSON line used to land here

			const after = await kernel.exec("after", "print(marker + 1)")
			expect(after.status).to.equal("ok")
			expect(after.stdout).to.equal("42\n")
		})

		it("stops a tight pure-Python loop", async () => {
			kernel = new Kernel()
			await kernel.exec("warm", "1") // the interpreter is slow to start; interrupt only a cell that is running
			kernel.send({ op: "exec", id: "spin", code: "kept = 7\nwhile True:\n    pass" })
			await sleep(500)
			const startedAt = Date.now()
			kernel.send({ op: "interrupt", target: "spin" })
			const result = await kernel.response("spin")
			expect(Date.now() - startedAt).to.be.lessThan(3000)
			expect(result.status).to.equal("interrupted")
			const after = await kernel.exec("after", "print(kept)")
			expect(after.stdout).to.equal("7\n")
		})

		it("ignores an interrupt aimed at a different exec or sent while idle", async () => {
			kernel = new Kernel()
			kernel.send({ op: "interrupt", target: "nothing-running" })
			kernel.send({ op: "exec", id: "slow", code: "import time\ntime.sleep(1.2)\nprint('finished')" })
			await sleep(300)
			kernel.send({ op: "interrupt", target: "some-other-exec" })
			const result = await kernel.response("slow")
			expect(result.status).to.equal("ok")
			expect(result.stdout).to.equal("finished\n")
		})

		it("cancels an exec that is interrupted before it started, without running it", async () => {
			kernel = new Kernel()
			await kernel.exec("warm", "1")
			kernel.send({ op: "exec", id: "first", code: "import time\ntime.sleep(0.8)\nran = ['first']" })
			kernel.send({ op: "exec", id: "second", code: "ran.append('second')" })
			kernel.send({ op: "interrupt", target: "second" })
			expect((await kernel.response("first")).status).to.equal("ok")
			const second = await kernel.response("second")
			expect(second.status).to.equal("interrupted")
			expect((await kernel.exec("check", "print(ran)")).stdout).to.equal("['first']\n")
		})

		it("reports a cell that swallows KeyboardInterrupt as still running (host then restarts)", async () => {
			kernel = new Kernel()
			await kernel.exec("warm", "1") // interrupt only a cell that has started
			kernel.send({
				op: "exec",
				id: "stubborn",
				code: "import time\nwhile True:\n    try:\n        time.sleep(0.05)\n    except KeyboardInterrupt:\n        pass",
			})
			await sleep(300)
			kernel.send({ op: "interrupt", target: "stubborn" })
			let answered = true
			try {
				await kernel.response("stubborn", 1200)
			} catch {
				answered = false
			}
			expect(answered, "a cell that catches KeyboardInterrupt must not be reported as interrupted").to.equal(false)
		})

		it("exits when the host closes the protocol pipe while a cell is busy, rather than outliving it", async () => {
			kernel = new Kernel()
			await kernel.exec("warm", "1")
			const exited = new Promise<number>((resolve) => {
				const started = Date.now()
				kernel!.child.once("exit", () => resolve(Date.now() - started))
			})
			kernel.send({ op: "exec", id: "spin", code: "while True:\n    pass" })
			await sleep(300)
			kernel.child.stdin.end()
			const afterMs = await Promise.race([exited, sleep(5000).then(() => -1)])
			console.log(`      [orphan exit] busy kernel exited ${afterMs} ms after stdin closed`)
			expect(afterMs).to.be.greaterThan(0)
			expect(afterMs).to.be.lessThan(2000)
		})

		it("still answers requests already queued when the host closes the pipe", async () => {
			kernel = new Kernel()
			kernel.send({ op: "exec", id: "a", code: "x = 40" })
			kernel.send({ op: "exec", id: "b", code: "print(x + 2)" })
			kernel.child.stdin.end()
			expect((await kernel.response("b")).stdout).to.equal("42\n")
		})

		it("survives user code that calls exit()", async () => {
			kernel = new Kernel()
			const result = await kernel.exec("exit", "import sys\nsys.exit(3)")
			expect(result.status).to.equal("error")
			expect(result.error).to.include("SystemExit")
			const after = await kernel.exec("after", "print('alive')")
			expect(after.stdout).to.equal("alive\n")
		})
	})

	describe("stdin and the protocol channel", () => {
		it("input() raises EOFError with a clear message and does not swallow the next request", async () => {
			kernel = new Kernel()
			kernel.send({ op: "exec", id: "ask", code: "x = input('name? ')" })
			kernel.send({ op: "ping", id: "p1" })
			kernel.send({ op: "exec", id: "next", code: "print('next ran')" })
			const ask = await kernel.response("ask")
			expect(ask.status).to.equal("error")
			expect(ask.error).to.include("EOFError")
			expect(ask.error).to.include("input() is not supported")
			expect((await kernel.response("p1")).stdout).to.equal("pong")
			expect((await kernel.response("next")).stdout).to.equal("next ran\n")
		})

		it("sys.stdin.read() returns empty rather than reading requests", async () => {
			kernel = new Kernel()
			kernel.send({ op: "exec", id: "read", code: "import sys\nprint(repr(sys.stdin.read()))" })
			kernel.send({ op: "ping", id: "p1" })
			expect((await kernel.response("read")).stdout).to.equal("''\n")
			expect((await kernel.response("p1")).stdout).to.equal("pong")
		})

		it("raw fd writes and child processes cannot corrupt the response stream", async () => {
			kernel = new Kernel()
			const result = await kernel.exec(
				"fd",
				[
					"import os, subprocess, sys",
					"os.write(1, b'RAW-FD-1\\n')",
					"subprocess.run([sys.executable, '-c', 'print(\"CHILD\")'])",
					"print('visible')",
				].join("\n"),
			)
			expect(result.status).to.equal("ok")
			expect(result.stdout).to.equal("visible\n")
			expect((await kernel.exec("ping-after", "1")).result_repr).to.equal("1")
		})
	})

	describe("cell hygiene", () => {
		it("does not leak figures from a failed cell into the next cell", async function () {
			kernel = new Kernel()
			const probe = await kernel.exec("probe", "import matplotlib")
			if (probe.status !== "ok") this.skip() // matplotlib not installed in this interpreter

			const failed = await kernel.exec("fail", "import matplotlib.pyplot as plt\nplt.plot([1, 2, 3])\n1 / 0")
			expect(failed.status).to.equal("error")
			expect(failed.images_png_base64).to.deep.equal([])
			const next = await kernel.exec("next", "print('clean')")
			expect(next.images_png_base64).to.deep.equal([])

			const good = await kernel.exec("good", "import matplotlib.pyplot as plt\nplt.plot([1, 2, 3])")
			expect((good.images_png_base64 as string[]).length).to.equal(1)
		})

		it("trims runner internals from tracebacks but keeps the user's frames", async () => {
			kernel = new Kernel()
			const result = await kernel.exec(
				"tb",
				"def inner():\n    return 1 / 0\n\ndef outer():\n    return inner()\n\nouter()",
			)
			expect(result.status).to.equal("error")
			expect(result.error).to.not.include("artifact_kernel_runner")
			expect(result.error).to.not.include("exec(compile")
			expect(result.error).to.include('File "<aihydro-cell>", line 7, in <module>')
			expect(result.error).to.include("in inner")
			expect(result.error).to.include("ZeroDivisionError")

			const syntax = await kernel.exec("syn", "def (")
			expect(syntax.error).to.include("SyntaxError")
			expect(syntax.error).to.not.include("artifact_kernel_runner")

			const chained = await kernel.exec(
				"chain",
				"try:\n    1 / 0\nexcept ZeroDivisionError as e:\n    raise ValueError('wrapped') from e",
			)
			expect(chained.error).to.include("ValueError")
			expect(chained.error).to.include("ZeroDivisionError")
			expect(chained.error).to.not.include("artifact_kernel_runner")
		})

		it("explains magics and shell escapes instead of a bare SyntaxError", async () => {
			kernel = new Kernel()
			const magic = await kernel.exec("m", "%matplotlib inline\nprint('x')")
			expect(magic.status).to.equal("error")
			expect(magic.error).to.include("Magic commands")
			expect(magic.error).to.include("not supported")
			expect(magic.error).to.include("%matplotlib inline")

			const shell = await kernel.exec("s", "!pip install foo")
			expect(shell.error).to.include("Shell escapes")

			// A % or ! at the start of a line inside a string is valid Python and must still run.
			const inString = await kernel.exec("str", 'text = """\n%not a magic\n!nor this\n"""\nprint(len(text.splitlines()))')
			expect(inString.status).to.equal("ok")
		})
	})

	describe("display()", () => {
		it("shows images from _repr_png_ and text for everything else", async () => {
			kernel = new Kernel()
			const result = await kernel.exec(
				"d",
				[
					"class Pic:",
					"    def _repr_png_(self):",
					"        return b'\\x89PNG-fake'",
					"class Table:",
					"    def __repr__(self):",
					"        return 'a  b\\n1  2'",
					"    def _repr_html_(self):",
					"        return '<table><tr><td>1</td></tr></table>'",
					"display(Pic(), Table(), 'plain text')",
				].join("\n"),
			)
			expect(result.status).to.equal("ok")
			expect(result.images_png_base64).to.deep.equal([Buffer.from("\x89PNG-fake", "binary").toString("base64")])
			expect(result.stdout).to.equal("a  b\n1  2\nplain text\n")
		})

		it("makes `from IPython.display import ...` work when IPython is not installed", async () => {
			kernel = new Kernel({ AIHYDRO_KERNEL_IPYTHON_SHIM: "1" })
			const result = await kernel.exec(
				"ip",
				"from IPython.display import display, HTML, Markdown\ndisplay(HTML('<b>bold</b>'), Markdown('# title'))",
			)
			expect(result.status).to.equal("ok")
			expect(result.stdout).to.equal("bold\n# title\n")
		})
	})

	describe("queueing", () => {
		it("runs requests sent back-to-back in order, each answered once", async () => {
			kernel = new Kernel()
			kernel.send({ op: "exec", id: "A", code: "import time\ntime.sleep(0.4)\nseen = ['A']" })
			kernel.send({ op: "exec", id: "B", code: "seen.append('B')" })
			kernel.send({ op: "exec", id: "C", code: "seen.append('C')\nprint(seen)" })
			const c = await kernel.response("C")
			expect(c.stdout).to.equal("['A', 'B', 'C']\n")
			expect(kernel.order).to.deep.equal(["A", "B", "C"])
		})
	})
})
