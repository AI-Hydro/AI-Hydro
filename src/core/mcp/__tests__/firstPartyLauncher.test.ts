import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { getRecordedFirstPartyLauncher, isServerTrusted, setRecordedFirstPartyLauncher } from "@/shared/aihydro/firstPartyServers"
import {
	FIRST_PARTY_LAUNCHER_FILE,
	loadFirstPartyLauncher,
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
