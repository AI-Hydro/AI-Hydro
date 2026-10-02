import { expect } from "chai"
import { describe, it } from "mocha"
import { pythonFromMcpServer, type ResolveDeps, resolveAiHydroPython } from "../resolveAiHydroPython"

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
	it("uses VIRTUAL_ENV then PATH python3", async () => {
		const deps = makeDeps({ importable: ["python3"], env: { VIRTUAL_ENV: "/v" } })
		const r = await resolveAiHydroPython(base, deps)
		expect(r).to.deep.include({ ok: true, command: "python3" })
		expect(deps.probed).to.deep.equal(["/v/bin/python", "python3"])
	})
	it("never probes author-machine paths", async () => {
		const deps = makeDeps({})
		await resolveAiHydroPython(base, deps)
		expect(deps.probed.join(" ")).to.not.match(/miniconda|homebrew|\/Users\//)
	})
	it("returns a clear error naming the install command and setting when nothing imports", async () => {
		const deps = makeDeps({})
		const r = await resolveAiHydroPython(base, deps)
		expect(r.ok).to.equal(false)
		if (!r.ok) {
			expect(r.error).to.include("pip install aihydro-tools")
			expect(r.error).to.include("aihydro.hydro.pythonPath")
			expect(r.error).to.include("python3")
		}
	})
})
