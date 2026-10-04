import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import * as path from "node:path"
import { expect } from "chai"
import { describe, it } from "mocha"

const RUNNER = path.resolve(__dirname, "..", "artifact_kernel_runner.py")

function runKernel(lines: string[]): Promise<Record<string, unknown>[]> {
	return new Promise((resolve, reject) => {
		const child = spawn("python3", [RUNNER], { stdio: ["pipe", "pipe", "pipe"] })
		const outputs: Record<string, unknown>[] = []
		let buffer = ""

		child.stdout.on("data", (chunk: Buffer) => {
			buffer += chunk.toString()
			const parts = buffer.split("\n")
			buffer = parts.pop() ?? ""
			for (const line of parts) {
				if (line.trim()) {
					outputs.push(JSON.parse(line) as Record<string, unknown>)
				}
			}
		})

		child.stderr.on("data", () => {})
		child.on("error", reject)
		child.on("close", (code) => {
			if (code !== 0 && outputs.length === 0) {
				reject(new Error(`kernel exited ${code}`))
				return
			}
			resolve(outputs)
		})

		for (const line of lines) {
			child.stdin.write(`${line}\n`)
		}
		child.stdin.end()
	})
}

describe("artifact_kernel_runner.py", function () {
	this.timeout(15_000)

	before(function () {
		if (!existsSync(RUNNER)) {
			this.skip()
		}
	})

	it("persists variables across exec calls", async () => {
		const responses = await runKernel([
			JSON.stringify({ op: "ping", id: "ping" }),
			JSON.stringify({ op: "exec", id: "a", code: "x = 41" }),
			JSON.stringify({ op: "exec", id: "b", code: "x += 1\nprint(x)" }),
		])

		expect(responses[0]?.status).to.equal("ok")
		expect(responses[2]?.status).to.equal("ok")
		expect(String(responses[2]?.stdout)).to.include("42")
	})

	it("returns the representation of the final expression", async () => {
		const responses = await runKernel([
			JSON.stringify({ op: "ping", id: "ping" }),
			JSON.stringify({ op: "exec", id: "result", code: 'print("ready")\n6 * 7' }),
		])

		expect(responses[1]?.status).to.equal("ok")
		expect(responses[1]?.stdout).to.equal("ready\n")
		expect(responses[1]?.result_repr).to.equal("42")
	})

	it("returns traceback on syntax errors", async () => {
		const responses = await runKernel([
			JSON.stringify({ op: "ping", id: "ping" }),
			JSON.stringify({ op: "exec", id: "bad", code: "def (" }),
		])

		expect(responses[1]?.status).to.equal("error")
		expect(String(responses[1]?.error)).to.include("SyntaxError")
	})

	it("degrades gracefully on a video cell when manim is unavailable", async () => {
		// _render_manim_videos()'s own `from manim import Scene, tempconfig` is
		// what triggers the graceful-degrade path — it runs unconditionally,
		// before the cell's own content is inspected for a Scene subclass. A
		// cell defining no Scene at all only reaches that import; whether
		// manim is actually installed on the interpreter running this test
		// determines which of the two DIFFERENT non-crashing outcomes below is
		// correct, so both are accepted rather than assuming the interpreter
		// lacks manim (it may not — this test previously assumed a bare CI
		// venv and failed on any dev machine with manim installed).
		const responses = await runKernel([
			JSON.stringify({ op: "ping", id: "ping" }),
			JSON.stringify({
				op: "exec",
				id: "v",
				code: "# __aihydro_render_video__\nprint('built scene')",
			}),
		])

		const res = responses[1]
		if (res?.status === "ok") {
			// manim unavailable: ImportError caught, stderr note, no crash.
			expect(String(res?.stderr)).to.include("Manim is not installed")
		} else {
			// manim available but this cell defines no Scene subclass: a
			// real, structured error (not a crash) is the correct outcome.
			expect(res?.status).to.equal("error")
			expect(String(res?.error)).to.include("No user-defined manim Scene subclass")
		}
	})

	it("renders an MP4 for a video cell that defines a manim Scene, when manim is installed", async function () {
		this.timeout(30_000)
		const manimAvailable = await new Promise<boolean>((resolve) => {
			const probe = spawn("python3", ["-c", "import manim"])
			probe.on("error", () => resolve(false))
			probe.on("close", (code) => resolve(code === 0))
		})
		if (!manimAvailable) {
			this.skip()
		}

		const responses = await runKernel([
			JSON.stringify({ op: "ping", id: "ping" }),
			JSON.stringify({
				op: "exec",
				id: "v",
				code: [
					"# __aihydro_render_video__",
					"from manim import Scene, Circle, Create",
					"class ProbeScene(Scene):",
					"    def construct(self):",
					"        self.play(Create(Circle()))",
				].join("\n"),
			}),
		])

		const res = responses[1]
		expect(res?.status).to.equal("ok")
		expect(Array.isArray(res?.videos_mp4_base64)).to.equal(true)
		expect((res?.videos_mp4_base64 as unknown[]).length).to.be.greaterThan(0)
	})

	it("clears namespace on restart", async () => {
		const responses = await runKernel([
			JSON.stringify({ op: "ping", id: "ping" }),
			JSON.stringify({ op: "exec", id: "a", code: "y = 99" }),
			JSON.stringify({ op: "restart", id: "r" }),
			JSON.stringify({ op: "exec", id: "b", code: "print(y)" }),
		])

		expect(responses[3]?.status).to.equal("error")
		expect(String(responses[3]?.error)).to.include("NameError")
	})
})
