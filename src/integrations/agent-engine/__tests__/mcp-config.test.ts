import { expect } from "chai"
import proxyquire from "proxyquire"
import sinon from "sinon"

function loadModule(opts: { settingsExists: boolean; settingsContent?: unknown }) {
	const writeFile = sinon.fake.resolves(undefined)
	const readFile = sinon.fake.resolves(JSON.stringify(opts.settingsContent ?? {}))
	const { writeEngineMcpConfig } = proxyquire("../mcp-config", {
		"@core/storage/disk": {
			ensureSettingsDirectoryExists: sinon.fake.resolves("/settings"),
			GlobalFileNames: { mcpSettings: "aihydro_mcp_settings.json" },
		},
		"@utils/fs": {
			fileExistsAtPath: sinon.fake.resolves(opts.settingsExists),
		},
		"fs/promises": { readFile, writeFile },
		"@noCallThru": false,
	})
	return { writeEngineMcpConfig, writeFile, readFile }
}

describe("writeEngineMcpConfig", function () {
	// First test in this file pays a one-time ts-node cold-compile cost for
	// mcp-config.ts's aliased dependency graph, occasionally exceeding
	// mocha's default 2000ms.
	this.timeout(10000)
	afterEach(() => sinon.restore())

	it("throws a clear error when no MCP settings file exists yet", async () => {
		const { writeEngineMcpConfig } = loadModule({ settingsExists: false })
		let thrown: Error | undefined
		try {
			await writeEngineMcpConfig()
		} catch (err) {
			thrown = err as Error
		}
		expect(thrown).to.exist
		expect(thrown!.message).to.include("No MCP settings found")
	})

	it("throws a clear error when ai-hydro is not registered in settings", async () => {
		const { writeEngineMcpConfig } = loadModule({
			settingsExists: true,
			settingsContent: { mcpServers: { "some-other-server": { command: "x" } } },
		})
		let thrown: Error | undefined
		try {
			await writeEngineMcpConfig()
		} catch (err) {
			thrown = err as Error
		}
		expect(thrown).to.exist
		expect(thrown!.message).to.include("is not registered")
	})

	it("writes a single-server config using the exact persisted ai-hydro entry", async () => {
		const serverConfig = { command: "/opt/miniconda3/bin/aihydro-mcp", args: [], cwd: "/cache", timeout: 600 }
		const { writeEngineMcpConfig, writeFile } = loadModule({
			settingsExists: true,
			settingsContent: { mcpServers: { "ai-hydro": serverConfig, other: { command: "y" } } },
		})

		const outPath = await writeEngineMcpConfig()

		expect(outPath).to.be.a("string")
		expect(writeFile.calledOnce).to.be.true
		const [writtenPath, writtenContent] = writeFile.firstCall.args
		expect(writtenPath).to.equal(outPath)
		const parsed = JSON.parse(writtenContent as string)
		expect(parsed).to.deep.equal({ mcpServers: { "ai-hydro": serverConfig } })
		// Only the ai-hydro entry is carried over — no other registered servers leak in.
		expect(Object.keys(parsed.mcpServers)).to.deep.equal(["ai-hydro"])
	})
})
