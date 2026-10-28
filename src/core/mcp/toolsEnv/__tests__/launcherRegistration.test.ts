import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { getRecordedFirstPartyLauncher, setRecordedFirstPartyLauncher } from "@/shared/aihydro/firstPartyServers"
import { readFirstPartyLauncher, recordFirstPartyLauncher } from "../../firstPartyLauncher"
import {
	classifyLauncher,
	findFirstPartyEntryName,
	readMcpSettings,
	readTrustSnapshot,
	registerManagedLauncher,
} from "../launcherRegistration"

const MANAGED = "/home/u/.aihydro/venvs/tools-2.8/bin/aihydro-mcp"

describe("managed launcher registration and trust", () => {
	let dir: string
	let settingsPath: string
	let saved: ReturnType<typeof getRecordedFirstPartyLauncher>
	beforeEach(async () => {
		saved = getRecordedFirstPartyLauncher()
		setRecordedFirstPartyLauncher(undefined)
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "tools-reg-"))
		settingsPath = path.join(dir, "aihydro_mcp_settings.json")
	})
	afterEach(async () => {
		setRecordedFirstPartyLauncher(saved)
		await fs.rm(dir, { recursive: true, force: true })
	})

	const opts = (over: Partial<Parameters<typeof registerManagedLauncher>[0]> = {}) => ({
		settingsDir: dir,
		settingsPath,
		managedCommand: MANAGED,
		cacheDir: path.join(dir, "cache"),
		switchExisting: false,
		confirmTrust: async () => {
			throw new Error("confirmTrust must not be asked")
		},
		...over,
	})
	const writeSettings = (servers: Record<string, unknown>) =>
		fs.writeFile(settingsPath, JSON.stringify({ mcpServers: servers }))

	it("fresh profile: registers the managed command and records it as the trust anchor without asking", async () => {
		const r = await registerManagedLauncher(opts())
		expect(r.record).to.equal("recorded")
		expect(r.serverName).to.equal("ai-hydro")
		const settings = await readMcpSettings(settingsPath)
		expect(settings.ok && settings.config.mcpServers["ai-hydro"].command).to.equal(MANAGED)
		const recorded = await readFirstPartyLauncher(dir)
		expect(recorded).to.include({ name: "ai-hydro", command: MANAGED })
		expect((await readTrustSnapshot(dir, settingsPath)).trust).to.equal("trusted")
	})

	it("a second registration with the same launcher changes nothing and does not ask", async () => {
		await registerManagedLauncher(opts())
		const before = await fs.readFile(path.join(dir, "aihydro_first_party_launcher.json"), "utf-8")
		const r = await registerManagedLauncher(opts())
		expect(r.record).to.equal("unchanged")
		expect(r.wrote).to.equal(false)
		expect(await fs.readFile(path.join(dir, "aihydro_first_party_launcher.json"), "utf-8")).to.equal(before)
	})

	it("a changed command requires confirmation and is never auto-trusted", async () => {
		await recordFirstPartyLauncher(dir, { name: "aihydro-tools", command: "/opt/miniconda3/bin/aihydro-mcp", args: [] })
		// The registered entry (already the managed venv, like the owner's machine) differs from the record.
		await writeSettings({ "aihydro-tools": { command: MANAGED, args: [], autoApprove: ["x"] } })
		let asked: { command: string; recordedCommand?: string } | undefined
		const declined = await registerManagedLauncher(
			opts({
				confirmTrust: async (launcher, recorded) => {
					asked = { command: launcher.command, recordedCommand: recorded?.command }
					return false
				},
			}),
		)
		expect(asked).to.deep.equal({ command: MANAGED, recordedCommand: "/opt/miniconda3/bin/aihydro-mcp" })
		expect(declined.serverName).to.equal("aihydro-tools") // adopts the existing entry, no second server
		expect(declined.record).to.equal("declined")
		expect((await readFirstPartyLauncher(dir))?.command).to.equal("/opt/miniconda3/bin/aihydro-mcp")
		expect((await readTrustSnapshot(dir, settingsPath)).trust).to.equal("untrusted")

		const accepted = await registerManagedLauncher(opts({ confirmTrust: async () => true }))
		expect(accepted.record).to.equal("confirmed")
		expect((await readTrustSnapshot(dir, settingsPath)).trust).to.equal("trusted")
	})

	it("switching an existing launcher keeps the user's entry fields, drops PYTHONPATH, and asks before trusting", async () => {
		await recordFirstPartyLauncher(dir, { name: "ai-hydro", command: "/usr/local/bin/aihydro-mcp", args: [] })
		await writeSettings({
			"ai-hydro": {
				command: "/usr/local/bin/aihydro-mcp",
				args: [],
				autoApprove: ["start_session"],
				env: { PYTHONPATH: "/checkout", AIHYDRO_HOME: "/pilot" },
			},
		})
		let asked = 0
		const r = await registerManagedLauncher(
			opts({
				switchExisting: true,
				confirmTrust: async () => {
					asked++
					return false
				},
			}),
		)
		expect(r.switchedFrom).to.equal("/usr/local/bin/aihydro-mcp")
		expect(asked).to.equal(1)
		const s = await readMcpSettings(settingsPath)
		const entry = s.ok ? s.config.mcpServers["ai-hydro"] : undefined
		expect(entry?.command).to.equal(MANAGED)
		expect(entry?.autoApprove).to.deep.equal(["start_session"])
		expect(entry?.env).to.deep.equal({ AIHYDRO_HOME: "/pilot" })
	})

	it("does not rewrite an existing different launcher unless the caller decided to switch", async () => {
		await writeSettings({ "ai-hydro": { command: "/usr/local/bin/aihydro-mcp", args: [] } })
		const r = await registerManagedLauncher(opts())
		expect(r.wrote).to.equal(false)
		const s = await readMcpSettings(settingsPath)
		expect(s.ok && s.config.mcpServers["ai-hydro"].command).to.equal("/usr/local/bin/aihydro-mcp")
	})

	it("refuses to touch a malformed settings file", async () => {
		await fs.writeFile(settingsPath, "{ not json")
		let threw = false
		try {
			await registerManagedLauncher(opts())
		} catch {
			threw = true
		}
		expect(threw).to.equal(true)
		expect(await fs.readFile(settingsPath, "utf-8")).to.equal("{ not json")
	})

	it("classifies registrations", async () => {
		const deps = { platform: "linux" as const, pathExists: async (p: string) => p === "/usr/local/bin/aihydro-mcp" }
		expect(await classifyLauncher(undefined, MANAGED, deps)).to.equal("none")
		expect(await classifyLauncher({ command: MANAGED, args: [] }, MANAGED, deps)).to.equal("managed")
		expect(await classifyLauncher({ command: "/usr/local/bin/aihydro-mcp", args: [] }, MANAGED, deps)).to.equal(
			"custom-working",
		)
		expect(await classifyLauncher({ command: "/gone/bin/aihydro-mcp", args: [] }, MANAGED, deps)).to.equal("custom-broken")
		expect(await classifyLauncher({ command: "python3", args: ["-m", "ai_hydro.mcp"] }, MANAGED, deps)).to.equal(
			"custom-working",
		)
		expect(await classifyLauncher({ command: "uvx", args: ["something"] }, MANAGED, deps)).to.equal("non-standard")
	})

	it("finds a legacy first-party key rather than creating a second server", () => {
		expect(findFirstPartyEntryName({ other: {}, "aihydro-tools": {} })).to.equal("aihydro-tools")
		expect(findFirstPartyEntryName({ "ai-hydro": {}, "aihydro-tools": {} })).to.equal("ai-hydro")
		expect(findFirstPartyEntryName({ other: {} })).to.equal(undefined)
	})
})
