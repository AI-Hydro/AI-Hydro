/**
 * Runs against a REAL built region archive. The file is 40+ MB and is never committed, so this test runs only when
 * AIHYDRO_B2_TILES_DIR points at a directory holding `rivers72.pmtiles` and its sidecar (CI skips it; the synthetic
 * five-layer test in meritRivers.test.ts always runs).
 */
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { gunzipSync } from "node:zlib"
import { MERIT_LAYER_NAMES, MERIT_MSG } from "@shared/map/meritTileContract"
import { Compression } from "pmtiles"
import { describe, expect, it } from "vitest"
import { MeritArchiveRegistry } from "../../../../../../src/hosts/vscode/meritTiles"
import type { HostTransport } from "../hostRangeSource"
import { type MeritSegment, MeritTileReader } from "../meritRivers"

const real = process.env.AIHYDRO_B2_TILES_DIR
const decompress = async (buf: ArrayBuffer, c: Compression) =>
	c === Compression.Gzip ? (Uint8Array.from(gunzipSync(Buffer.from(buf))).buffer as ArrayBuffer) : buf

describe.skipIf(!real)("real region-72 archive", () => {
	it("is sidecar-verified, decodes all five layers, and 10 reaches read through our source equal the file's values", async () => {
		const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "merit-real-"))
		try {
			for (const n of ["rivers72.pmtiles", "rivers72.pmtiles.provenance.json"])
				fs.copyFileSync(path.join(real as string, n), path.join(dir, n))
			const registry = new MeritArchiveRegistry({ tilesDir: () => dir })
			await registry.scan()
			await registry.whenVerified()
			const offer = registry.snapshot().archives[0]
			expect(offer.provenance.verification).toBe("sha256-verified")
			// schema 2 sidecar: the attribution keeps the NC-SA words with the "exact variant unresolved" suffix, and the note shows
			expect(offer.provenance.attribution).toContain("CC BY-NC-SA")
			expect(offer.provenance.attribution).toContain("exact variant unresolved")
			expect(offer.provenance.licenceNote).toContain("unresolved")
			expect(typeof offer.provenance.reachesAbsent).toBe("number")
			expect(offer.provenance.sourcePinned).toBe("true")
			const file = fs.readFileSync(path.join(dir, "rivers72.pmtiles"))
			expect(createHash("sha256").update(file).digest("hex")).toBe(offer.provenance.tilesSha256)

			const listeners = new Set<(d: unknown) => void>()
			const transport: HostTransport = {
				listen: (h) => (listeners.add(h), () => listeners.delete(h)),
				post: (m) => {
					const r = m as { requestId: string; archiveId: string; offset: number; length: number }
					void registry
						.readRange(r.archiveId, r.offset, r.length)
						.then(({ data, etag }) =>
							listeners.forEach((l) =>
								l({ type: MERIT_MSG.rangeResult, requestId: r.requestId, ok: true, data, etag }),
							),
						)
				},
			}
			const viaHost = new MeritTileReader(offer, { transport, decompress })
			const direct = new MeritTileReader(offer, {
				decompress,
				source: {
					getKey: () => "direct",
					getBytes: async (o, l) => ({
						data: file.subarray(o, o + l).buffer.slice(file.byteOffset + o, file.byteOffset + o + l) as ArrayBuffer,
					}),
				},
			})
			// z9 tile over southern Quebec and a z12 tile inside it; z3 for the coarse layer
			const z9 = await viaHost.getTile(9, 150, 180)
			const bands = new Set<string>()
			for (const t of [
				[3, 2, 2],
				[6, 18, 22],
				[7, 37, 45],
				[9, 150, 180],
				[11, 602, 722],
				[12, 1204, 1445],
			]) {
				for (const s of await viaHost.getTile(t[0], t[1], t[2])) bands.add(s.band)
			}
			expect([...bands].sort()).toEqual([...MERIT_LAYER_NAMES].sort())
			expect(z9.length).toBeGreaterThan(0)
			const six = await viaHost.getTile(6, 18, 22)
			const sample: MeritSegment[] = Array.from({ length: 10 }, (_, i) => six[Math.floor((i * six.length) / 10)])
			const ref = new Map((await direct.getTile(6, 18, 22)).map((s) => [`${s.comid}:${s.path.length}`, s]))
			for (const s of sample) {
				const r = ref.get(`${s.comid}:${s.path.length}`)
				expect(r, `comid ${s.comid}`).toBeDefined()
				expect([r?.comid, r?.uparea, r?.sorder]).toEqual([s.comid, s.uparea, s.sorder])
			}
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	}, 120_000)
})
