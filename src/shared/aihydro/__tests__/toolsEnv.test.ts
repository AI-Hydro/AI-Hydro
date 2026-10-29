import { expect } from "chai"
import { describe, it } from "mocha"
import {
	describeToolsStatus,
	emptyToolsEnvStatus,
	formatToolsDiagnostics,
	pythonMeetsMinimum,
	venvMcpPath,
	venvPythonPath,
	versionMeetsFloor,
} from "../toolsEnv"

describe("tools environment model", () => {
	it("applies the ~=2.8.2 floor but adopts newer lines", () => {
		expect(versionMeetsFloor("2.8.2")).to.equal(true)
		expect(versionMeetsFloor("2.8.10")).to.equal(true)
		expect(versionMeetsFloor("2.9.0")).to.equal(true)
		expect(versionMeetsFloor("2.8.1")).to.equal(false)
		expect(versionMeetsFloor("2.5.0")).to.equal(false)
		expect(versionMeetsFloor("")).to.equal(false)
	})

	it("requires Python 3.10", () => {
		expect(pythonMeetsMinimum("3.10.0")).to.equal(true)
		expect(pythonMeetsMinimum("3.12.4")).to.equal(true)
		expect(pythonMeetsMinimum("3.9.18")).to.equal(false)
		expect(pythonMeetsMinimum("2.7.18")).to.equal(false)
	})

	it("derives per-platform venv paths", () => {
		expect(venvPythonPath("/v", "linux")).to.equal("/v/bin/python")
		expect(venvMcpPath("/v/", "darwin")).to.equal("/v/bin/aihydro-mcp")
		expect(venvPythonPath("C:\\v", "win32")).to.equal("C:\\v\\Scripts\\python.exe")
		expect(venvMcpPath("C:\\v\\", "win32")).to.equal("C:\\v\\Scripts\\aihydro-mcp.exe")
	})

	it("describes each state with the actions that fit it", () => {
		const s = (o: Parameters<typeof emptyToolsEnvStatus>[0]) => describeToolsStatus(emptyToolsEnvStatus(o))
		const ready = s({ phase: "ready", healthy: true, version: "2.8.2", trust: "trusted" })
		expect(ready.label).to.equal("Tools 2.8.2 · healthy · trusted")
		expect(ready.tone).to.equal("ok")
		const untrusted = s({ phase: "ready", healthy: true, version: "2.8.2", trust: "untrusted" })
		expect(untrusted.label).to.equal("Tools 2.8.2 · healthy · not trusted")
		expect(untrusted.actions).to.include("trust")
		expect(s({ phase: "installing" }).actions).to.deep.equal(["cancel", "showLog"])
		expect(s({ phase: "unhealthy", version: "2.8.1" }).actions).to.deep.equal(["repair", "showLog"])
		expect(s({ phase: "failed" }).actions).to.deep.equal(["retry", "showLog"])
		expect(s({ phase: "missing" }).actions).to.deep.equal(["install", "showLog"])
	})

	it("formats diagnostics with interpreter, venv, version, command and trust", () => {
		const text = formatToolsDiagnostics(
			emptyToolsEnvStatus({
				phase: "ready",
				healthy: true,
				version: "2.8.2",
				trust: "trusted",
				interpreterPath: "/v/bin/python",
				venvPath: "/v",
				serverName: "ai-hydro",
				serverCommand: "/v/bin/aihydro-mcp",
			}),
			"0.4.0",
		)
		for (const needle of [
			"Extension build: 0.4.0",
			"Tools version: 2.8.2",
			"Interpreter: /v/bin/python",
			"Venv path: /v",
			"Server command: /v/bin/aihydro-mcp",
			"Trust: trusted",
		]) {
			expect(text).to.include(needle)
		}
	})
})
