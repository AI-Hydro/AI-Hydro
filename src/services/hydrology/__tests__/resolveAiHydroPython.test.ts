import { expect } from "chai"
import { describe, it } from "mocha"
import {
	pythonFromMcpServer,
	type ResolveDeps,
	resolveAiHydroPython,
	resolveOnPath,
	trustedPythonSetting,
} from "../resolveAiHydroPython"

const MODS = ["ai_hydro.hydro_map_cli"]

function makeDeps(opts: {
	importable?: string[]
	shebangs?: Record<string, string>
	files?: string[]
	platform?: NodeJS.Platform
	env?: NodeJS.ProcessEnv
}): ResolveDeps & { probed: string[] } {
	const probed: string[] = []
	return {
		probed,
		canImport: async (command) => {
			probed.push(command)
			return (opts.importable ?? []).includes(command)
		},
		readFirstLine: async (f) => opts.shebangs?.[f],
		exists: async (f) => (opts.files ?? []).includes(f),
		platform: opts.platform ?? "linux",
		env: opts.env ?? {},
	}
}

const base = { modules: MODS, settingName: "aihydro.hydro.pythonPath" }

describe("pythonFromMcpServer", () => {
	it("uses a python command directly", async () => {
		const deps = makeDeps({})
		expect(await pythonFromMcpServer({ command: "/envs/x/bin/python", args: ["-m", "ai_hydro.mcp"] }, deps)).to.equal(
			"/envs/x/bin/python",
		)
	})
	it("reads the console-script shebang", async () => {
		const deps = makeDeps({ shebangs: { "/envs/x/bin/aihydro-mcp": "#!/envs/x/bin/python3.11" } })
		expect(await pythonFromMcpServer({ command: "/envs/x/bin/aihydro-mcp" }, deps)).to.equal("/envs/x/bin/python3.11")
	})
	it("ignores env shebangs and falls back to a sibling python", async () => {
		const deps = makeDeps({
			shebangs: { "/envs/x/bin/aihydro-mcp": "#!/usr/bin/env python3" },
			files: ["/envs/x/bin/python"],
		})
		expect(await pythonFromMcpServer({ command: "/envs/x/bin/aihydro-mcp" }, deps)).to.equal("/envs/x/bin/python")
	})
	it("returns undefined for relative commands or missing entry", async () => {
		const deps = makeDeps({})
		expect(await pythonFromMcpServer({ command: "aihydro-mcp" }, deps)).to.equal(undefined)
		expect(await pythonFromMcpServer(undefined, deps)).to.equal(undefined)
	})
})

describe("resolveAiHydroPython", () => {
	it("prefers the explicit setting when it can import the module", async () => {
		const deps = makeDeps({ importable: ["/cfg/python", "python3"] })
		const r = await resolveAiHydroPython({ ...base, configuredPath: "/cfg/python" }, deps)
		expect(r).to.deep.include({ ok: true, command: "/cfg/python" })
		expect(deps.probed).to.deep.equal(["/cfg/python"])
	})
	it("falls through a broken setting to the MCP server interpreter", async () => {
		const deps = makeDeps({ importable: ["/mcp/python"] })
		const r = await resolveAiHydroPython(
			{ ...base, configuredPath: "/broken/python", mcpServer: { command: "/mcp/python" } },
			deps,
		)
		expect(r).to.deep.include({ ok: true, command: "/mcp/python", source: "ai-hydro MCP server config" })
	})
	it("uses VIRTUAL_ENV then PATH python3 (resolved to an absolute path)", async () => {
		const deps = makeDeps({
			importable: ["/usr/bin/python3"],
			env: { VIRTUAL_ENV: "/v", PATH: "/usr/bin" },
			files: ["/v/bin/python", "/usr/bin/python3"],
		})
		const r = await resolveAiHydroPython(base, deps)
		expect(r).to.deep.include({ ok: true, command: "/usr/bin/python3" })
		expect(deps.probed).to.deep.equal(["/v/bin/python", "/usr/bin/python3"])
	})
	it("never probes author-machine paths", async () => {
		const deps = makeDeps({})
		await resolveAiHydroPython(base, deps)
		expect(deps.probed.join(" ")).to.not.match(/miniconda|homebrew|\/Users\//)
	})
	it("returns a clear error naming the install command and setting when nothing imports", async () => {
		const deps = makeDeps({ env: { PATH: "/usr/bin" }, files: ["/usr/bin/python3"] })
		const r = await resolveAiHydroPython(base, deps)
		expect(r.ok).to.equal(false)
		if (!r.ok) {
			expect(r.error).to.include("pip install aihydro-tools")
			expect(r.error).to.include("aihydro.hydro.pythonPath")
			expect(r.error).to.include("/usr/bin/python3")
		}
	})
})

describe("PATH lookup is explicit and never cwd-relative", () => {
	const win = (files: string[], env: NodeJS.ProcessEnv = {}) =>
		makeDeps({ platform: "win32", files, env: { PATH: "C:\\Python311;.;relative\\bin;;C:\\Windows", ...env } })

	it("resolves bare python on win32 to an absolute .exe from PATH entries", async () => {
		const deps = win(["C:\\Python311\\python.exe"])
		expect(await resolveOnPath("python", deps)).to.equal("C:\\Python311\\python.exe")
	})
	it("ignores a python.exe planted in the cwd or a relative PATH entry", async () => {
		const deps = win(["python.exe", ".\\python.exe", "relative\\bin\\python.exe", "\\python.exe"])
		expect(await resolveOnPath("python", deps)).to.equal(undefined)
		const r = await resolveAiHydroPython(
			base,
			makeDeps({
				...{},
				platform: "win32",
				importable: ["python", "python.exe"],
				env: { PATH: ".;relative" },
				files: ["python.exe"],
			}),
		)
		expect(r.ok).to.equal(false)
	})
	it("probes only the absolute path on win32", async () => {
		const deps = makeDeps({
			platform: "win32",
			env: { PATH: "C:\\Python311" },
			files: ["C:\\Python311\\python.exe"],
			importable: ["C:\\Python311\\python.exe"],
		})
		const r = await resolveAiHydroPython(base, deps)
		expect(r).to.deep.include({ ok: true, command: "C:\\Python311\\python.exe" })
		expect(deps.probed).to.deep.equal(["C:\\Python311\\python.exe"])
	})
	it("refuses cwd-relative paths with separators from settings", async () => {
		const deps = makeDeps({ env: { PATH: "/usr/bin" }, importable: ["./venv/bin/python"] })
		const r = await resolveAiHydroPython({ ...base, configuredPath: "./venv/bin/python" }, deps)
		expect(r.ok).to.equal(false)
		expect(deps.probed).to.not.include("./venv/bin/python")
	})
})

describe("trustedPythonSetting", () => {
	it("returns the user/machine value and ignores workspace values with a log note", () => {
		const logs: string[] = []
		const v = trustedPythonSetting(
			{ globalValue: "/user/python", workspaceValue: "/repo/evil", workspaceFolderValue: "/repo/evil2" },
			"aihydro.hydro.pythonPath",
			(m) => logs.push(m),
		)
		expect(v).to.equal("/user/python")
		expect(logs).to.have.length(1)
		expect(logs[0]).to.include("Ignoring workspace-scoped")
	})
	it("returns undefined when only a workspace value exists", () => {
		const logs: string[] = []
		expect(trustedPythonSetting({ workspaceValue: "/repo/evil" }, "x", (m) => logs.push(m))).to.equal(undefined)
		expect(logs).to.have.length(1)
	})
	it("does not log when nothing is workspace-scoped", () => {
		const logs: string[] = []
		expect(trustedPythonSetting({ globalValue: " " }, "x", (m) => logs.push(m))).to.equal(undefined)
		expect(logs).to.have.length(0)
	})
})
