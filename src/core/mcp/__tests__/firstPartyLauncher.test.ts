import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { getRecordedFirstPartyLauncher, isServerTrusted, setRecordedFirstPartyLauncher } from "@/shared/aihydro/firstPartyServers"
import {
	FIRST_PARTY_LAUNCHER_FILE,
	loadFirstPartyLauncher,
	migrateFirstPartyAnchor,
	readFirstPartyLauncher,
	recordFirstPartyLauncher,
} from "../firstPartyLauncher"

describe("first-party launcher record (B4)", () => {
	let dir: string
	let saved: ReturnType<typeof getRecordedFirstPartyLauncher>
	beforeEach(async () => {
		saved = getRecordedFirstPartyLauncher()
		setRecordedFirstPartyLauncher(undefined)
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "launcher-"))
	})
	afterEach(async () => {
		setRecordedFirstPartyLauncher(saved)
		await fs.rm(dir, { recursive: true, force: true })
	})

	const launcher = { name: "ai-hydro", command: "/opt/miniconda3/bin/aihydro-mcp", args: [] as string[] }
	const connection = (command: string) => ({ name: "ai-hydro", config: JSON.stringify({ type: "stdio", command, args: [] }) })

	it("records at registration and the persisted record becomes the trust anchor after a restart", async () => {
		await recordFirstPartyLauncher(dir, launcher)
		expect(isServerTrusted(connection(launcher.command))).to.equal(true)
		// Simulate a restart: clear the in-memory record, reload from disk.
		setRecordedFirstPartyLauncher(undefined)
		expect(isServerTrusted(connection(launcher.command))).to.equal(false)
		expect(await loadFirstPartyLauncher(dir)).to.deep.equal(launcher)
		expect(isServerTrusted(connection(launcher.command))).to.equal(true)
		expect(isServerTrusted(connection("/tmp/evil"))).to.equal(false)
	})

	it("a missing or malformed record means nobody is trusted", async () => {
		expect(await loadFirstPartyLauncher(dir)).to.equal(undefined)
		await fs.writeFile(path.join(dir, FIRST_PARTY_LAUNCHER_FILE), "{not json")
		expect(await readFirstPartyLauncher(dir)).to.equal(undefined)
		await fs.writeFile(path.join(dir, FIRST_PARTY_LAUNCHER_FILE), JSON.stringify({ name: "ai-hydro", command: 3, args: [] }))
		expect(await readFirstPartyLauncher(dir)).to.equal(undefined)
		expect(isServerTrusted(connection(launcher.command))).to.equal(false)
	})
})

describe("migrateFirstPartyAnchor (S6)", () => {
	let dir: string
	let saved: ReturnType<typeof getRecordedFirstPartyLauncher>
	beforeEach(async () => {
		saved = getRecordedFirstPartyLauncher()
		setRecordedFirstPartyLauncher(undefined)
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "launcher-migrate-"))
	})
	afterEach(async () => {
		setRecordedFirstPartyLauncher(saved)
		await fs.rm(dir, { recursive: true, force: true })
	})

	const recorded = { name: "ai-hydro", command: "/opt/miniconda3/bin/aihydro-mcp", args: [] as string[] }
	const legacy = (command: string, args: string[] = []) => ({ type: "stdio", command, args })
	const view = (name: string, command: string, args: string[] = []) => ({
		name,
		config: JSON.stringify({ type: "stdio", command, args }),
	})
	const never = async () => {
		throw new Error("confirm must not be called")
	}

	it("same launch line under another enabled first-party name: re-recorded silently, legacy server becomes trusted", async () => {
		await recordFirstPartyLauncher(dir, recorded)
		const outcome = await migrateFirstPartyAnchor(
			dir,
			{ "ai-hydro": { ...legacy(recorded.command), disabled: true }, "aihydro-tools": legacy(recorded.command) },
			never,
		)
		expect(outcome).to.equal("renamed")
		expect(await readFirstPartyLauncher(dir)).to.deep.equal({ ...recorded, name: "aihydro-tools" })
		expect(isServerTrusted(view("aihydro-tools", recorded.command))).to.equal(true)
		expect(isServerTrusted(view("ai-hydro", recorded.command))).to.equal(false)
	})

	it("a different launch line is re-recorded only when the human confirms", async () => {
		await recordFirstPartyLauncher(dir, recorded)
		const servers = {
			"ai-hydro": { ...legacy(recorded.command), disabled: true },
			"aihydro-tools": legacy("python3", ["-m", "ai_hydro.mcp"]),
		}
		let asked: unknown
		expect(
			await migrateFirstPartyAnchor(dir, servers, async (candidate) => {
				asked = candidate
				return false
			}),
		).to.equal("declined")
		expect(asked).to.deep.equal({ name: "aihydro-tools", command: "python3", args: ["-m", "ai_hydro.mcp"] })
		expect(await readFirstPartyLauncher(dir)).to.deep.equal(recorded)
		expect(isServerTrusted(view("aihydro-tools", "python3", ["-m", "ai_hydro.mcp"]))).to.equal(false)

		expect(await migrateFirstPartyAnchor(dir, servers, async () => true)).to.equal("confirmed")
		expect(isServerTrusted(view("aihydro-tools", "python3", ["-m", "ai_hydro.mcp"]))).to.equal(true)
	})

	it("adversarial: a look-alike third-party server never becomes trusted and the record is untouched", async () => {
		await recordFirstPartyLauncher(dir, recorded)
		for (const servers of [
			{ "ai-hydro": { ...legacy(recorded.command), disabled: true }, "aihydro-tools": legacy("/tmp/evil-mcp") },
			{ "ai-hydro": { ...legacy(recorded.command), disabled: true }, "my-aihydro": legacy(recorded.command) },
			{
				"ai-hydro": { ...legacy(recorded.command), disabled: true },
				"aihydro-tools": { type: "sse", url: "https://evil" },
			},
			{
				"ai-hydro": { ...legacy(recorded.command), disabled: true },
				"aihydro-tools": legacy(recorded.command, ["--evil"]),
			},
		]) {
			expect(await migrateFirstPartyAnchor(dir, servers as any, never)).to.equal("none")
		}
		expect(await readFirstPartyLauncher(dir)).to.deep.equal(recorded)
		expect(isServerTrusted(view("aihydro-tools", "/tmp/evil-mcp"))).to.equal(false)
	})

	it("ambiguous candidates change nothing", async () => {
		await recordFirstPartyLauncher(dir, recorded)
		const outcome = await migrateFirstPartyAnchor(
			dir,
			{
				"ai-hydro": { ...legacy(recorded.command), disabled: true },
				"aihydro-tools": legacy(recorded.command),
				aihydro: legacy(recorded.command),
			},
			never,
		)
		expect(outcome).to.equal("ambiguous")
		expect(await readFirstPartyLauncher(dir)).to.deep.equal(recorded)
	})
})
