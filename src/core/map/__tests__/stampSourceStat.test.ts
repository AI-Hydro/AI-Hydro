import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { stampSourceStat } from "../MapEventWatcher"

describe("a tool's layer records the size and time of the file it names", () => {
	let dir: string
	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "aih-stamp-"))
	})
	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	it("stamps an absolute path, so a change while VS Code is closed can be seen at restore", async () => {
		const file = path.join(dir, "out.geojson")
		await fs.writeFile(file, "{}")
		const meta: Record<string, string> = { source_path: file, tool: "t" }
		await stampSourceStat(meta)
		expect(meta.source_size_bytes).to.equal("2")
		expect(Number(meta.source_mtime_ms)).to.be.greaterThan(0)
	})

	it("keeps what the tool recorded, and records nothing for a missing file, a folder or a relative path", async () => {
		const file = path.join(dir, "out.geojson")
		await fs.writeFile(file, "{}")
		const own: Record<string, string> = { source_path: file, source_size_bytes: "9" }
		await stampSourceStat(own)
		expect(own.source_size_bytes).to.equal("9")
		for (const meta of [
			{ source_path: path.join(dir, "gone.geojson") },
			{ source_path: dir },
			{ source_path: "out.geojson" },
			{},
		] as Array<Record<string, string>>) {
			await stampSourceStat(meta)
			expect(meta.source_size_bytes).to.equal(undefined)
		}
	})
})
