import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import * as vscode from "vscode"
import { ArtifactKernelService } from "../ArtifactKernelService"
import type { KernelProfile } from "../KernelProfile"

const RUNNER = path.resolve(process.cwd(), "src", "services", "artifact-preview", "artifact_kernel_runner.py")
const PYTHON = process.env.AIHYDRO_TEST_PYTHON || process.env.AIHYDRO_E2E_PYTHON || "python3"
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Real kernel processes, real protocol: only the VS Code surface is faked.
describe("ArtifactKernelService (real kernel)", function () {
	this.timeout(60_000)
	let root: string
	let service: ArtifactKernelService
	const vsc = vscode as any

	beforeEach(function () {
		if (!existsSync(RUNNER)) this.skip()
		root = mkdtempSync(path.join(os.tmpdir(), "aihydro-kernel-svc-"))
		const dist = path.join(root, "ext", "dist", "services", "artifact-preview")
		mkdirSync(dist, { recursive: true })
		cpSync(RUNNER, path.join(dist, "artifact_kernel_runner.py"))
		const workspace = path.join(root, "ws")
		mkdirSync(workspace)
		vsc.window.createOutputChannel = () => ({ appendLine: () => {} })
		vsc.workspace.workspaceFolders = [{ uri: { fsPath: workspace, toString: () => `file://${workspace}` } }]
		service = new ArtifactKernelService({
			extensionPath: path.join(root, "ext"),
			globalState: { get: () => "", update: () => {} },
		} as any)
		const profile: KernelProfile = {
			id: "test",
			label: "test",
			interpreterPath: PYTHON,
			cwd: workspace,
			env: {},
		} as KernelProfile
		sinon.stub(service, "resolveProfile").resolves(profile)
	})

	afterEach(() => {
		service.dispose()
		sinon.restore()
		delete vsc.workspace.workspaceFolders
		rmSync(root, { recursive: true, force: true })
	})

	it("interrupts a 5 s sleep at 1 s, ends within ~1.5 s, reports the kernel's own outcome, and keeps variables", async () => {
		await service.execute("marker = 41", "art")
		const startedAt = Date.now()
		const run = service.execute("import time\ntime.sleep(5)\nprint('NOT_INTERRUPTED')", "art", "test", undefined, "sleepy")
		await sleep(1000)
		const outcome = await service.interruptKernel("art", "test")
		const result = await run
		const elapsed = Date.now() - startedAt
		console.log(`      [host interrupt timing] sleep(5) interrupted at 1.0 s; run settled after ${elapsed} ms`)

		expect(elapsed).to.be.lessThan(2000) // the protocol-level test holds the tighter 1.5 s bound
		expect(outcome.recovered).to.equal(true)
		expect(result.status).to.equal("interrupted")
		expect(result.error).to.include("KeyboardInterrupt")
		expect(result.stdout).to.not.include("NOT_INTERRUPTED")
		const after = await service.execute("print(marker + 1)", "art")
		expect(after.stdout).to.equal("42\n")
	})

	it("serialises concurrent runs in arrival order; none is dropped or left running", async () => {
		const runs = [
			service.execute("import time\ntime.sleep(0.5)\norder = ['A']\nprint(order)", "art"),
			service.execute("order.append('B')\nprint(order)", "art"),
			service.execute("order.append('C')\nprint(order)", "art"),
		]
		const results = await Promise.all(runs)
		expect(results.map((r) => r.stdout)).to.deep.equal(["['A']\n", "['A', 'B']\n", "['A', 'B', 'C']\n"])
	})

	it("a timeout the kernel survives keeps variables and says so", async () => {
		await service.execute("kept = 5", "art")
		const result = await service.execute("while True:\n    pass", "art", "test", 600)
		expect(result.status).to.equal("timeout")
		expect(result.error).to.include("kernel kept its variables")
		expect((await service.execute("print(kept)", "art")).stdout).to.equal("5\n")
	})

	it("a timeout the kernel cannot honour restarts it and states that variables were cleared", async () => {
		service.interruptGraceMs = 400
		await service.execute("kept = 5", "art")
		const stubborn = "import time\nwhile True:\n    try:\n        time.sleep(0.02)\n    except BaseException:\n        pass"
		const result = await service.execute(stubborn, "art", "test", 400)
		expect(result.status).to.equal("timeout")
		expect(result.error).to.include("Kernel restarted: variables were cleared")
		const after = await service.execute("print(kept)", "art")
		expect(after.status).to.equal("error")
		expect(after.error).to.include("NameError")
	})

	it("Stop on a cell that will not stop reports the restart, never 'Interrupted'", async () => {
		service.interruptGraceMs = 400
		await service.execute("kept = 5", "art")
		const run = service.execute(
			"import time\nwhile True:\n    try:\n        time.sleep(0.02)\n    except BaseException:\n        pass",
			"art",
		)
		await sleep(500)
		const outcome = await service.interruptKernel("art", "test")
		const result = await run
		expect(outcome.recovered).to.equal(false)
		expect(result.status).to.equal("error")
		expect(result.error).to.include("Kernel restarted: variables were cleared")
		expect(result.error).to.not.include("Interrupted:")
	})

	it("tells the learner when an idle kernel died and variables are gone", async () => {
		await service.execute("kept = 5", "art")
		const session = [...((service as any).sessions as Map<string, any>).values()][0]
		session.process.kill("SIGKILL")
		await sleep(300)
		const result = await service.execute("print('hello')", "art")
		expect(result.stderr).to.include("Kernel restarted: variables were cleared")
		expect(result.stdout).to.equal("hello\n")
	})

	it("records the code text, output digests and the practice label for each run", async () => {
		const result = await service.execute("print('hi')", "art", "test", undefined, "cell-1")
		const runsDir = path.join(root, "ws", ".aihydro", "runs")
		const files = readdirSync(runsDir).filter((f) => f.startsWith("art_cell-1_"))
		expect(files).to.have.length(1)
		expect(result.provenanceId).to.equal(files[0].replace(/\.json$/, ""))
		const record = JSON.parse(readFileSync(path.join(runsDir, files[0]), "utf8"))
		expect(record.codeText).to.equal("print('hi')")
		expect(record.codeHash).to.match(/^sha256:[0-9a-f]{64}$/)
		expect(record.outputDigests.stdout).to.match(/^sha256:[0-9a-f]{64}$/)
		expect(record.packagesDigest).to.match(/^sha256:[0-9a-f]{64}$/)
		expect(record.recording).to.equal("practice-not-server-recorded")
	})

	it("Stop during kernel start-up cancels the pending run instead of reporting recovered for nothing", async () => {
		const run = service.execute("import time\ntime.sleep(5)\nprint('RAN')", "art", "test", undefined, "early")
		await sleep(50) // the interpreter is still starting; no session.current yet
		const outcome = await service.interruptKernel("art", "test")
		const result = await run
		expect(result.status).to.equal("interrupted")
		expect(result.error).to.include("Cancelled")
		expect(result.stdout).to.not.include("RAN")
		expect(outcome.recovered).to.equal(true) // nothing was executing: the run never started
	})

	it("a kernel crash during Stop is not reported as recovered", async () => {
		await service.execute("kept = 1", "art")
		const run = service.execute("import os, time\ntry:\n    time.sleep(30)\nexcept KeyboardInterrupt:\n    os._exit(3)", "art")
		await sleep(500)
		const outcome = await service.interruptKernel("art", "test")
		const result = await run
		expect(result.status).to.equal("error")
		expect(outcome.recovered).to.equal(false)
	})

	it("a run record that cannot be written does not fail the finished run", async () => {
		vsc.workspace.workspaceFolders = [{ uri: { fsPath: path.join(root, "ws", "no-such", "\0bad"), toString: () => "file://bad" } }]
		const result = await service.execute("print('fine')", "art", "test", undefined, "cell-x")
		expect(result.status).to.equal("ok")
		expect(result.stdout).to.equal("fine\n")
		expect(result.provenanceId).to.equal(undefined)
	})
})
