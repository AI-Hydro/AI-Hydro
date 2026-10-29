import { expect } from "chai"
import { describe, it } from "mocha"
import { MANAGED_VENV_NAME, TOOLS_REQUIREMENT, venvMcpPath, venvPythonPath } from "@/shared/aihydro/toolsEnv"
import { ensureToolsEnv, findBasePython, probeToolsEnv } from "../managedVenv"
import { createFakeMachine, makeVenv } from "./fakeToolsEnv"

const VENV = `/home/u/.aihydro/venvs/${MANAGED_VENV_NAME}`
const PY = venvPythonPath(VENV, "linux")
const base = { venvDir: VENV, pythonCandidates: ["python3", "python"] }

describe("managed tools venv lifecycle", () => {
	it("creates the venv with the base python and installs the pinned requirement with the venv python only", async () => {
		const m = createFakeMachine(VENV)
		const steps: string[] = []
		const r = await ensureToolsEnv(m.deps, { ...base, onStep: (s) => steps.push(s) })
		expect(r.outcome).to.equal("created")
		expect(r.probe.healthy).to.equal(true)
		expect(r.probe.version).to.equal("2.8.2")
		const venvCall = m.calls.find((c) => c.includes("venv"))
		expect(venvCall).to.deep.equal(["python3", "-m", "venv", VENV])
		const pip = m.calls.filter((c) => c.includes("pip"))
		expect(pip).to.have.length(1)
		expect(pip[0][0]).to.equal(PY) // never the base interpreter
		expect(pip[0]).to.include(TOOLS_REQUIREMENT)
		expect(TOOLS_REQUIREMENT).to.equal("aihydro-tools[data,analysis,mcp,viz,gee,delineation]~=2.8.2")
		expect(m.calls.some((c) => c[0] === "python3" && c.includes("pip"))).to.equal(false)
		expect(steps.some((s) => /Creating/.test(s))).to.equal(true)
	})

	it("adopts an existing healthy environment without creating or installing anything", async () => {
		const m = createFakeMachine(VENV)
		makeVenv(m, "2.8.2")
		const r = await ensureToolsEnv(m.deps, base)
		expect(r.outcome).to.equal("adopted")
		expect(m.calls.some((c) => c.includes("pip") || c.includes("venv"))).to.equal(false)
		expect(m.handshakes).to.deep.equal([venvMcpPath(VENV, "linux")])
	})

	it("adopts a hand-upgraded newer version rather than downgrading it", async () => {
		const m = createFakeMachine(VENV)
		makeVenv(m, "2.9.0")
		expect((await ensureToolsEnv(m.deps, base)).outcome).to.equal("adopted")
		expect(m.installed.version).to.equal("2.9.0")
	})

	it("upgrades an adopted environment that is below the pinned floor", async () => {
		const m = createFakeMachine(VENV)
		makeVenv(m, "2.8.0")
		const r = await ensureToolsEnv(m.deps, base)
		expect(r.outcome).to.equal("upgraded")
		expect(m.installed.version).to.equal("2.8.2")
		expect(m.calls.some((c) => c.includes("venv"))).to.equal(false)
	})

	it("repairs an unhealthy environment in place (pip, no venv recreation)", async () => {
		const m = createFakeMachine(VENV)
		makeVenv(m, "2.8.2")
		m.handshakeFailures.count = 1 // first probe fails, the post-install probe passes
		const r = await ensureToolsEnv(m.deps, base)
		expect(r.outcome).to.equal("repaired")
		expect(r.probe.healthy).to.equal(true)
		expect(m.calls.some((c) => c.includes("venv"))).to.equal(false)
		expect(m.calls.filter((c) => c.includes("pip"))).to.have.length(1)
	})

	it("without Repair an unhealthy result is reported after one pip run: no automatic --force-reinstall", async () => {
		const m = createFakeMachine(VENV)
		makeVenv(m, "2.8.2")
		m.handshakeFailures.count = 5
		const r = await ensureToolsEnv(m.deps, { ...base })
		expect(r.errorCode).to.equal("UNHEALTHY")
		const pips = m.calls.filter((c) => c.includes("pip"))
		expect(pips).to.have.length(1)
		expect(pips[0]).to.not.include("--force-reinstall")
	})

	it("an explicit Repair retries once with --force-reinstall and then reports UNHEALTHY with the probe error", async () => {
		const m = createFakeMachine(VENV)
		makeVenv(m, "2.8.2")
		m.handshakeFailures.count = 5
		const r = await ensureToolsEnv(m.deps, { ...base, repair: true })
		expect(r.outcome).to.equal("failed")
		expect(r.errorCode).to.equal("UNHEALTHY")
		expect(r.message).to.match(/MCP handshake/)
		const pips = m.calls.filter((c) => c.includes("pip"))
		expect(pips).to.have.length(2)
		expect(pips[1]).to.include("--force-reinstall")
	})

	it("Repair forces a pip run even when the environment already looks healthy", async () => {
		const m = createFakeMachine(VENV)
		makeVenv(m, "2.8.2")
		const r = await ensureToolsEnv(m.deps, { ...base, repair: true })
		expect(r.outcome).to.equal("repaired")
		expect(m.calls.filter((c) => c.includes("pip"))).to.have.length(1)
	})

	it("reports NO_PYTHON with an actionable message, and does not run pip, when no suitable interpreter exists", async () => {
		const m = createFakeMachine(VENV)
		m.pythons.clear()
		m.pythons.set("python3", "3.9.18") // too old
		const r = await ensureToolsEnv(m.deps, base)
		expect(r.outcome).to.equal("failed")
		expect(r.errorCode).to.equal("NO_PYTHON")
		expect(r.message).to.match(/3\.10/)
		expect(r.message).to.match(/aihydro\.tools\.pythonPath/)
		expect(m.calls.some((c) => c.includes("pip") || c.includes("venv"))).to.equal(false)
	})

	it("prefers the configured interpreter over python3", async () => {
		const m = createFakeMachine(VENV)
		m.pythons.set("/opt/py311/bin/python", "3.11.4")
		const r = await ensureToolsEnv(m.deps, { ...base, pythonCandidates: ["/opt/py311/bin/python", "python3"] })
		expect(r.basePython).to.equal("/opt/py311/bin/python")
		expect(m.calls.find((c) => c.includes("venv"))?.[0]).to.equal("/opt/py311/bin/python")
	})

	it("skips an interpreter that is too old and falls through to the next", async () => {
		const m = createFakeMachine(VENV)
		m.pythons.set("/old/python", "3.8.10")
		const found = await findBasePython(m.deps, ["/old/python", "python3"])
		expect(found?.path).to.equal("python3")
	})

	it("does not overwrite a directory that is not a virtualenv", async () => {
		const m = createFakeMachine(VENV)
		m.files.add(VENV)
		m.files.add(`${VENV}/notes.txt`)
		const r = await ensureToolsEnv(m.deps, base)
		expect(r.errorCode).to.equal("NOT_A_VENV")
		expect(m.calls.some((c) => c.includes("venv") || c.includes("pip"))).to.equal(false)
	})

	it("never pip-installs into a working python that is not a venv (no pyvenv.cfg)", async () => {
		const m = createFakeMachine(VENV)
		m.files.add(VENV)
		m.files.add(PY) // a conda/system prefix: python runs, no pyvenv.cfg
		const r = await ensureToolsEnv(m.deps, { ...base, repair: true })
		expect(r.errorCode).to.equal("NOT_A_VENV")
		expect(m.calls.some((c) => c.includes("pip"))).to.equal(false)
	})

	it("never pip-installs when pyvenv.cfg exists but the interpreter reports sys.prefix == sys.base_prefix", async () => {
		const m = createFakeMachine(VENV)
		makeVenv(m, "")
		m.nonVenvPython.value = true
		const r = await ensureToolsEnv(m.deps, { ...base })
		expect(r.errorCode).to.equal("NOT_A_VENV")
		expect(m.calls.some((c) => c.includes("pip"))).to.equal(false)
	})

	it("a python that exists but fails or times out is unhealthy, never recreated or cleared", async () => {
		const m = createFakeMachine(VENV)
		makeVenv(m, "2.8.2")
		m.venvPythonBroken.value = true
		const r = await ensureToolsEnv(m.deps, { ...base, isDefaultDir: true, confirmRecreate: async () => true })
		expect(r.errorCode).to.equal("UNHEALTHY")
		expect(m.calls.some((c) => c.includes("--clear") || c.includes("venv") || c.includes("pip"))).to.equal(false)
	})

	it("a venv that lost its interpreter is only cleared for the default dir and after confirmation", async () => {
		const mk = () => {
			const m = createFakeMachine(VENV)
			m.files.add(VENV)
			m.files.add(`${VENV}/pyvenv.cfg`) // interpreter file is gone
			return m
		}
		let m = mk()
		expect((await ensureToolsEnv(m.deps, base)).errorCode).to.equal("VENV_BROKEN")
		m = mk()
		expect(
			(await ensureToolsEnv(m.deps, { ...base, isDefaultDir: false, confirmRecreate: async () => true })).errorCode,
		).to.equal("VENV_BROKEN")
		m = mk()
		expect(
			(await ensureToolsEnv(m.deps, { ...base, isDefaultDir: true, confirmRecreate: async () => false })).errorCode,
		).to.equal("VENV_BROKEN")
		expect(m.calls.some((c) => c.includes("--clear"))).to.equal(false)
		m = mk()
		const r = await ensureToolsEnv(m.deps, { ...base, isDefaultDir: true, confirmRecreate: async () => true })
		expect(r.outcome).to.equal("created")
		expect(m.calls.find((c) => c.includes("venv"))).to.include("--clear")
	})

	it("stops with LOCKED when another process holds the install lock", async () => {
		const m = createFakeMachine(VENV)
		m.lockHeld.pid = 4242
		const r = await ensureToolsEnv(m.deps, base)
		expect(r.errorCode).to.equal("LOCKED")
		expect(r.message).to.match(/4242/)
		expect(m.calls.some((c) => c.includes("venv") || c.includes("pip"))).to.equal(false)
	})

	it("health probes run the interpreter isolated (-I)", async () => {
		const m = createFakeMachine(VENV)
		makeVenv(m, "2.8.2")
		await probeToolsEnv(m.deps, VENV)
		expect(m.calls.filter((c) => c[0] === PY).every((c) => c[1] === "-I")).to.equal(true)
	})

	it("treats an install cancelled mid-pip as cancelled, not failed, and leaves the venv for a retry", async () => {
		const m = createFakeMachine(VENV)
		const ac = new AbortController()
		m.onPip = async () => {
			ac.abort()
			return { exitCode: null, stdout: "", stderr: "", aborted: true }
		}
		const r = await ensureToolsEnv(m.deps, { ...base, signal: ac.signal })
		expect(r.outcome).to.equal("cancelled")
		expect(m.files.has(PY)).to.equal(true)
		// A retry with a fresh signal completes.
		m.onPip = undefined
		const again = await ensureToolsEnv(m.deps, base)
		expect(again.probe.healthy).to.equal(true)
	})

	it("classifies a pip network failure as OFFLINE", async () => {
		const m = createFakeMachine(VENV)
		m.pipResult = {
			exitCode: 1,
			stderr: "WARNING: Retrying ... Temporary failure in name resolution\nERROR: No matching distribution found",
		}
		const r = await ensureToolsEnv(m.deps, base)
		expect(r.errorCode).to.equal("OFFLINE")
		expect(r.message).to.match(/network or proxy/)
	})

	it("surfaces a plain pip error with its tail", async () => {
		const m = createFakeMachine(VENV)
		m.pipResult = { exitCode: 1, stderr: "ERROR: Could not build wheel for gdal" }
		const r = await ensureToolsEnv(m.deps, base)
		expect(r.errorCode).to.equal("PIP_FAILED")
		expect(r.message).to.match(/gdal/)
	})

	it("uses Windows layout (Scripts\\python.exe) on win32", async () => {
		const winVenv = "C:\\Users\\u\\.aihydro\\venvs\\tools-2.8"
		const m = createFakeMachine(winVenv, "win32")
		m.pythons.set("python", "3.11.0")
		const r = await ensureToolsEnv(m.deps, { venvDir: winVenv, pythonCandidates: ["python"] })
		expect(r.outcome).to.equal("created")
		expect(m.calls.find((c) => c.includes("pip"))?.[0]).to.equal(`${winVenv}\\Scripts\\python.exe`)
		expect(m.handshakes[0]).to.equal(`${winVenv}\\Scripts\\aihydro-mcp.exe`)
	})

	it("probe reports a missing interpreter without running anything", async () => {
		const m = createFakeMachine(VENV)
		const p = await probeToolsEnv(m.deps, VENV)
		expect(p.healthy).to.equal(false)
		expect(p.error).to.match(/no Python/)
		expect(m.calls).to.have.length(0)
	})
})
