import { MERIT_MAX_RANGE_BYTES, MERIT_SIDECAR_SUFFIX } from "@shared/map/meritTileContract"
import { expect } from "chai"
import { createHash, randomBytes } from "crypto"
import * as fs from "fs"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { MeritArchiveRegistry, meritTilesDir, parsePmtilesHeader } from "../meritTiles"

/** A file with a valid PMTiles v3 header (MVT tiles, bounds -93..-52 / 40..62) followed by random bytes. */
function fakeArchive(size: number): Buffer {
	const buf = randomBytes(size)
	buf.fill(0, 0, 127)
	buf.write("PMTiles", 0, "latin1")
	buf[7] = 3
	buf[99] = 1
	buf[100] = 0
	buf[101] = 12
	buf.writeInt32LE(-93 * 1e7, 102)
	buf.writeInt32LE(40 * 1e7, 106)
	buf.writeInt32LE(-52 * 1e7, 110)
	buf.writeInt32LE(62 * 1e7, 114)
	return buf
}

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex")

function sidecar(name: string, file: Buffer, overrides: Record<string, unknown> = {}) {
	return {
		tile_schema_version: 1,
		region: "72",
		source: { name: "rivers72.db", sha256: "a".repeat(64), sha256_origin: "staging_provenance_sidecar" },
		output: { name, size_bytes: file.length, sha256: sha(file) },
		licence: "CC BY-NC-SA 4.0",
		citation: "Lin et al. 2019",
		attribution: "Rivers: MERIT-Basins, Lin et al. 2019, CC BY-NC-SA 4.0",
		...overrides,
	}
}

describe("MERIT tile archive registry (host)", () => {
	let dir: string
	let file: Buffer
	const archive = () => path.join(dir, "rivers72.pmtiles")
	const write = (extra: Record<string, unknown> = {}, body: Buffer = file) => {
		fs.writeFileSync(archive(), body)
		fs.writeFileSync(archive() + MERIT_SIDECAR_SUFFIX, JSON.stringify(sidecar("rivers72.pmtiles", body, extra)))
	}
	const registry = (hashFile?: (f: string) => Promise<string>) => new MeritArchiveRegistry({ tilesDir: () => dir, hashFile })

	beforeEach(function () {
		this.timeout(20000)
		dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "merit-"))
		file = fakeArchive(300_000)
	})
	afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

	it("returns exact bytes for 1,000 random ranges, as an ArrayBuffer of that length", async function () {
		this.timeout(60000)
		write()
		const reg = registry()
		await reg.scan()
		for (let i = 0; i < 1000; i++) {
			const offset = Math.floor(Math.random() * file.length)
			const length = 1 + Math.floor(Math.random() * Math.min(40_000, file.length - offset))
			const { data } = await reg.readRange("rivers72", offset, length)
			expect(Object.prototype.toString.call(data)).to.equal("[object ArrayBuffer]")
			expect(Buffer.isBuffer(data)).to.equal(false)
			expect(data.byteLength).to.equal(length)
			expect(Buffer.from(data).equals(file.subarray(offset, offset + length))).to.equal(true)
		}
		await reg.whenVerified()
	})

	it("serves the PMTiles first read (16 KiB) on a smaller file as a short buffer", async () => {
		write({}, fakeArchive(5000))
		const reg = registry()
		await reg.scan()
		const { data } = await reg.readRange("rivers72", 0, 16384)
		expect(data.byteLength).to.equal(5000)
	})

	it("rejects unknown and path-like ids, bad offsets and lengths", async () => {
		write()
		const reg = registry()
		await reg.scan()
		const bad: Array<[unknown, unknown, unknown]> = [
			["rivers99", 0, 10],
			["../rivers72", 0, 10],
			["rivers72.pmtiles", 0, 10],
			[undefined, 0, 10],
			["rivers72", -1, 10],
			["rivers72", 1.5, 10],
			["rivers72", "0", 10],
			["rivers72", Number.NaN, 10],
			["rivers72", 0, 0],
			["rivers72", 0, 2.5],
			["rivers72", 0, MERIT_MAX_RANGE_BYTES + 1],
			["rivers72", file.length, 10],
			["rivers72", file.length - 1, 1 << 20],
		]
		for (const [id, offset, length] of bad) {
			let failed = false
			try {
				await reg.readRange(id, offset, length)
			} catch {
				failed = true
			}
			expect(failed, JSON.stringify([id, offset, length])).to.equal(true)
		}
	})

	it("refuses a symlinked archive and a symlinked sidecar", async function () {
		const outside = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "merit-out-"))
		try {
			fs.writeFileSync(path.join(outside, "real.pmtiles"), file)
			try {
				fs.symlinkSync(path.join(outside, "real.pmtiles"), archive())
			} catch {
				return this.skip() // symlinks need privileges on Windows
			}
			fs.writeFileSync(archive() + MERIT_SIDECAR_SUFFIX, JSON.stringify(sidecar("rivers72.pmtiles", file)))
			const reg = registry()
			const msg = await reg.scan()
			expect(msg.archives).to.have.length(0)
			expect(msg.notes.join(" ")).to.contain("not a regular file")
			fs.unlinkSync(archive())
			fs.writeFileSync(archive(), file)
			fs.unlinkSync(archive() + MERIT_SIDECAR_SUFFIX)
			fs.writeFileSync(path.join(outside, "s.json"), JSON.stringify(sidecar("rivers72.pmtiles", file)))
			fs.symlinkSync(path.join(outside, "s.json"), archive() + MERIT_SIDECAR_SUFFIX)
			expect((await reg.scan()).archives).to.have.length(0)
		} finally {
			fs.rmSync(outside, { recursive: true, force: true })
		}
	})

	it("offers an archive only with a valid sidecar, matching size and an NC-SA credit", async () => {
		const cases: Array<[string, Record<string, unknown>]> = [
			["attribution without NC-SA", { attribution: "Rivers: MERIT-Basins, CC BY 4.0" }],
			["wrong schema", { tile_schema_version: 2 }],
			["wrong size", { output: { name: "rivers72.pmtiles", size_bytes: 1, sha256: "b".repeat(64) } }],
			["no source hash", { source: { name: "x.db" } }],
		]
		for (const [label, extra] of cases) {
			write(extra)
			expect((await registry().scan()).archives, label).to.have.length(0)
		}
		fs.writeFileSync(archive(), file)
		fs.rmSync(archive() + MERIT_SIDECAR_SUFFIX)
		const missing = await registry().scan()
		expect(missing.archives).to.have.length(0)
		expect(missing.notes[0]).to.contain("no valid provenance record")
		write()
		const ok = await registry().scan()
		expect(ok.archives).to.have.length(1)
		expect(ok.archives[0].bounds).to.deep.equal([-93, 40, -52, 62])
		expect(ok.archives[0].provenance.verification).to.equal("size-matched")
	})

	it("reads optional sidecar keys when present and tolerates their absence", async () => {
		write({
			licence_note: "variant unresolved",
			source_pinned: "true",
			verified_at: "2026-11-09",
			reaches_dropped_at_maxzoom: 7,
		})
		const p = (await registry().scan()).archives[0].provenance
		expect(p.licenceNote).to.equal("variant unresolved")
		expect(p.reachesDropped).to.equal(7)
		write()
		expect((await registry().scan()).archives[0].provenance.licenceNote).to.equal(undefined)
	})

	it("upgrades to sha256-verified in the background, and withdraws on a mismatch", async () => {
		write()
		const reg = registry()
		await reg.scan()
		await reg.whenVerified()
		expect(reg.snapshot().archives[0].provenance.verification).to.equal("sha256-verified")

		const bad = registry(async () => "0".repeat(64))
		await bad.scan()
		await bad.whenVerified()
		expect(bad.snapshot().archives).to.have.length(0)
		expect(bad.snapshot().notes.join(" ")).to.contain("withdrawn")
		let failed = false
		await bad.readRange("rivers72", 0, 10).catch(() => {
			failed = true
		})
		expect(failed).to.equal(true)
	})

	it("refuses a read after the file changed on disk", async () => {
		write()
		const reg = registry()
		await reg.scan()
		await reg.whenVerified()
		fs.appendFileSync(archive(), "x")
		let failed = false
		await reg.readRange("rivers72", 0, 10).catch(() => {
			failed = true
		})
		expect(failed).to.equal(true)
	})

	it("rejects a non-PMTiles file and resolves the tiles directory like the builder", () => {
		expect(parsePmtilesHeader(Buffer.alloc(200))).to.be.a("string")
		expect(meritTilesDir({ AIHYDRO_MERIT_DIR: "/m" } as NodeJS.ProcessEnv)).to.equal(path.join("/m", "tiles"))
		expect(meritTilesDir({ MERIT_DATA_DIR: "/d", AIHYDRO_MERIT_DIR: "" } as NodeJS.ProcessEnv)).to.equal(
			path.join("/d", "tiles"),
		)
		expect(meritTilesDir({ AIHYDRO_HOME: "/h" } as NodeJS.ProcessEnv)).to.equal(path.join("/h", "merit", "tiles"))
	})
})
