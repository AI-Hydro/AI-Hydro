import * as fsp from "node:fs/promises"
import * as path from "node:path"
import { sanitizeMapLayerForWebview } from "@core/map/sanitizeMapLayerForWebview"
import { MapLayer } from "@shared/proto/cline/map"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { addLayer, fc, type Harness, layerFor, makeHarness, sha, until, wait } from "./fixtures/mapFileWatchHarness"

/**
 * The watcher's contract, case by case: a layer that names a file follows the file; a layer with an evidence link never
 * changes content by itself; nothing reveals the panel, draws an unmade copy, or watches a path the map may not load.
 * All files are in a scratch folder; the panel is a stub that parses the way the page does.
 */
describe("MapFileWatch", function () {
	this.timeout(15_000)
	let h: Harness
	let file: string
	beforeEach(async () => {
		h = await makeHarness()
		file = path.join(h.dir, "basin.geojson")
		await fsp.writeFile(file, fc(1))
		// A file written long before the layer was made, as a real one is: a rewrite can then be told by its time.
		const past = new Date(Date.now() - 60_000)
		await fsp.utimes(file, past, past)
	})
	afterEach(async () => {
		await h.cleanup()
	})

	const load = async (meta: Record<string, string> = {}, over: Partial<MapLayer> = {}) => {
		const layer = layerFor(file, fc(1), meta, over)
		addLayer(h, layer)
		await h.watch.sync()
		return layer
	}
	const layer = () => [...h.layers.values()][0]
	const hashOnMap = () => layer().metadata.source_sha256

	describe("a layer with no evidence link follows its file", () => {
		it("an in-place write updates it, keeping the id, style, visibility and order", async () => {
			const before = await load()
			addLayer(h, MapLayer.create({ id: "other", name: "other" }))
			h.order.unshift(h.order.pop() as string) // other first
			await fsp.writeFile(file, fc(2))
			h.emit(file)
			expect(await until(() => layer().geojson === fc(2))).to.equal(true)
			const after = h.layers.get(before.id) as MapLayer
			expect(after.id).to.equal(before.id)
			expect(after.style).to.deep.equal(before.style)
			expect(after.visible).to.equal(true)
			expect(after.name).to.equal(before.name)
			expect(h.layers.size).to.equal(2)
			expect(h.order).to.deep.equal(["other", before.id])
			expect(after.metadata.source_sha256).to.equal(sha(fc(2)))
			expect(after.metadata.source_size_bytes).to.equal(String(Buffer.byteLength(fc(2))))
			expect(after.metadata.source_status).to.equal("current")
			expect(after.metadata.source_updated_at_utc).to.match(/^\d{4}-\d\d-\d\dT/)
			expect(h.reports.map((r) => r.kind)).to.deep.equal(["updated"])
		})

		it("a user's display name and style survive; what the page's parse says about itself cannot set links or paths", async () => {
			await load({ display_name: "My basin" })
			await fsp.writeFile(file, fc(2))
			h.emit(file)
			expect(await until(() => layer().geojson === fc(2))).to.equal(true)
			const meta = layer().metadata
			expect(meta.display_name).to.equal("My basin")
			expect(meta.source_path).to.equal(file) // not "/etc/passwd"
			expect(meta._run_id).to.equal(undefined) // not "forged"
			expect(meta.tool).to.equal(undefined)
			expect(meta.source_format).to.equal("geojson")
		})

		it("os.replace (write elsewhere, rename over the file) updates it", async () => {
			await load()
			const tmp = path.join(h.dir, ".basin.geojson.tmp")
			await fsp.writeFile(tmp, fc(3))
			await fsp.rename(tmp, file)
			h.emit(tmp)
			h.emit(file)
			expect(await until(() => layer().geojson === fc(3))).to.equal(true)
			expect(h.reports.some((r) => r.kind === "missing")).to.equal(false)
		})

		it("delete then create is waited out: never shown as missing, and the new file is used", async () => {
			await load()
			await fsp.unlink(file)
			h.emit(file)
			await wait(40)
			await fsp.writeFile(file, fc(4))
			h.emit(file)
			expect(await until(() => layer().geojson === fc(4))).to.equal(true)
			expect(h.patches.some((p) => p.metadata.source_status === "source_missing")).to.equal(false)
			expect(layer().metadata.source_status).to.equal("current")
		})

		it("a file that stays deleted says so, keeps the last copy, and is current again when it comes back unchanged", async () => {
			await load()
			await fsp.unlink(file)
			h.emit(file)
			expect(await until(() => layer().metadata.source_status === "source_missing")).to.equal(true)
			expect(layer().geojson).to.equal(fc(1))
			await fsp.writeFile(file, fc(1))
			const st = await fsp.stat(file)
			// The layer's record is of the original file; the same bytes at a new time are the same content, but the time differs.
			await fsp.utimes(
				file,
				new Date(Number(layer().metadata.source_mtime_ms)),
				new Date(Number(layer().metadata.source_mtime_ms)),
			)
			expect(st.size).to.equal(Number(layer().metadata.source_size_bytes))
			await h.watch.checkAll()
			expect(await until(() => layer().metadata.source_status === "current")).to.equal(true)
		})

		it("a tool's layer is not marked missing when its file is gone (it has its own copy)", async () => {
			await load({ tool: "extract_rivers", _run_id: "r.1", study_id: "s" })
			await fsp.unlink(file)
			h.emit(file)
			await wait(300)
			expect(layer().metadata.source_status).to.equal("current")
		})

		for (const [label, bytes] of [
			["600 KB", 600_000],
			["5 MB", 5_000_000],
		] as const) {
			it(`a ${label} file updates, and the stale preview is dropped with the old content`, async () => {
				const big = (n: number) => fc(n, "x".repeat(bytes))
				await fsp.writeFile(file, big(1))
				const l = layerFor(file, big(1), {
					display_geojson_path: "/tmp/old-preview.geojson",
					display_mode: "preview",
					preview_feature_count: "1",
				})
				addLayer(h, l)
				await h.watch.sync()
				await fsp.writeFile(file, big(2))
				h.emit(file)
				expect(await until(() => layer().geojson === big(2), 5000)).to.equal(true)
				expect(layer().metadata.display_geojson_path).to.equal(undefined)
				expect(layer().metadata.display_mode).to.equal(undefined)
				expect(layer().metadata.source_sha256).to.equal(sha(big(2)))
				// What the panel is sent for a file this size: no content, no preview path. It draws the file itself.
				const sent = sanitizeMapLayerForWebview(layer())
				expect(sent.geojson).to.equal("")
				expect(sent.metadata.display_geojson_path).to.equal(undefined)
			})
		}

		it("a burst of writes is one check, and the last version is what the layer holds", async () => {
			await load()
			for (let n = 2; n <= 8; n++) {
				await fsp.writeFile(file, fc(n))
				h.emit(file)
				await wait(3)
			}
			expect(await until(() => layer().geojson === fc(8))).to.equal(true)
			await until(() => h.watch.isIdle())
			expect(h.requests.length).to.be.lessThan(4)
		})

		it("a version written while another is being read is not lost, and requests do not overlap", async () => {
			await load()
			let release: () => void = () => {}
			const gate = new Promise<void>((resolve) => (release = resolve))
			h.fetchHook = async () => {
				h.fetchHook = undefined
				await gate
			}
			await fsp.writeFile(file, fc(2))
			h.emit(file)
			await until(() => h.requests.length === 1)
			await fsp.writeFile(file, fc(3))
			h.emit(file)
			await wait(80)
			expect(h.requests.length).to.equal(1) // the second waits for the first
			release()
			expect(await until(() => layer().geojson === fc(3))).to.equal(true)
		})

		it("a touch (new time, same bytes) is not a change: no request, the record is brought up to date", async () => {
			await load({ source_sha256: sha(fc(1)) })
			const future = new Date(Date.now() + 60_000)
			await fsp.utimes(file, future, future)
			h.emit(file)
			expect(await until(() => Number(layer().metadata.source_mtime_ms) > Date.now())).to.equal(true)
			expect(h.requests.length).to.equal(0)
			expect(layer().geojson).to.equal(fc(1))
		})

		it("an events for a file no layer names does nothing", async () => {
			await load()
			const other = path.join(h.dir, "unrelated.json")
			await fsp.writeFile(other, "{}")
			h.emit(other)
			await wait(150)
			expect(h.requests.length).to.equal(0)
			expect(h.patches.length).to.equal(0)
		})
	})

	describe("hash on arrival", () => {
		it("the layer records the hash of the bytes the page parsed, never of a later version", async () => {
			await load()
			await fsp.writeFile(file, fc(2))
			// The file changes after the host hashed it and before the page read it: the page sees a different size.
			h.fetchHook = async () => {
				h.fetchHook = undefined
				await fsp.writeFile(file, fc(2, "longer than before, so the size differs"))
			}
			h.emit(file)
			expect(await until(() => layer().geojson === fc(2, "longer than before, so the size differs"))).to.equal(true)
			expect(layer().metadata.source_sha256).to.equal(sha(layer().geojson))
			expect(h.requests.length).to.equal(2)
			expect(h.requests[0].sha256).to.not.equal(h.requests[1].sha256)
		})

		it("a file that is still being written (size or time moving between reads) is not read until it settles", async () => {
			let stats = 0
			const real = { stat: (p: string) => fsp.stat(p), readFile: (p: string) => fsp.readFile(p) }
			await h.cleanup()
			h = await makeHarness({
				fs: {
					readFile: real.readFile,
					stat: async (p) => {
						const st = await real.stat(p)
						if (p === file && ++stats <= 4) return { size: st.size + stats, mtimeMs: st.mtimeMs }
						return st
					},
				},
			})
			file = path.join(h.dir, "basin.geojson")
			await fsp.writeFile(file, fc(1))
			await load()
			stats = 0
			await fsp.writeFile(file, fc(2))
			h.emit(file)
			expect(await until(() => layer().geojson === fc(2), 3000)).to.equal(true)
			expect(h.requests.length).to.equal(1)
		})
	})

	describe("a version that cannot be parsed", () => {
		it("is tried once more after the retry delay and used if it has settled", async () => {
			await load()
			await fsp.writeFile(file, '{"type":"FeatureCollection","features":[') // half a write
			h.emit(file)
			await until(() => h.requests.length === 1)
			await wait(40)
			await fsp.writeFile(file, fc(5)) // the writer finishes
			expect(await until(() => layer().geojson === fc(5), 4000)).to.equal(true)
			expect(layer().metadata.source_status).to.equal("current")
			expect(h.reports.some((r) => r.kind === "unreadable")).to.equal(false)
		})

		it("after the second failure the layer says it could not read the new version and keeps the last good copy", async () => {
			await load()
			await fsp.writeFile(file, "{ not json")
			h.emit(file)
			expect(await until(() => layer().metadata.source_status === "source_unreadable", 4000)).to.equal(true)
			expect(layer().geojson).to.equal(fc(1))
			expect(layer().metadata.source_error).to.contain("JSON")
			expect(h.requests.length).to.equal(2) // one try, one retry, no more
			expect(h.reports.filter((r) => r.kind === "unreadable").length).to.equal(1)
			// Looking again at the same unreadable version does not try again.
			await h.watch.checkAll()
			await wait(100)
			expect(h.requests.length).to.equal(2)
			// A good version clears it.
			await fsp.writeFile(file, fc(6))
			h.emit(file)
			expect(await until(() => layer().geojson === fc(6))).to.equal(true)
			expect(layer().metadata.source_status).to.equal("current")
			expect(layer().metadata.source_error).to.equal(undefined)
		})
	})

	describe("an evidence link stops auto-update", () => {
		for (const link of [
			{ _run_id: "dfetch.1.2.abcd1234" },
			{ study_id: "prj_x" },
			{ tool: "extract_rivers" },
			{ claim_id: "c1" },
		] as Array<Record<string, string>>) {
			it(`${Object.keys(link)[0]}: the file changing flags the layer and changes nothing else`, async () => {
				await load(link)
				const before = layer()
				await fsp.writeFile(file, fc(2))
				h.emit(file)
				expect(await until(() => layer().metadata.source_status === "source_changed")).to.equal(true)
				await wait(100)
				expect(layer().geojson).to.equal(before.geojson)
				expect(layer().metadata.source_sha256).to.equal(before.metadata.source_sha256)
				expect(layer().metadata.source_size_bytes).to.equal(before.metadata.source_size_bytes)
				expect(layer().metadata[Object.keys(link)[0]]).to.equal(Object.values(link)[0])
				expect(layer().metadata.source_seen_sha256).to.equal(sha(fc(2)))
				expect(h.requests.length).to.equal(0) // not even read by the page
				// Flagged once, not on every look.
				await h.watch.checkAll()
				await h.watch.checkAll()
				expect(h.patches.filter((p) => p.metadata.source_status === "source_changed").length).to.equal(1)
			})
		}

		it("the host refuses an automatic update even if one is asked for", async () => {
			await load({ _run_id: "dfetch.1.2.abcd1234" })
			const { refreshLayerFromFile } = await import("../refreshFromFile")
			const out = refreshLayerFromFile(
				layer(),
				{ geojson: fc(9), snapshot: { sizeBytes: 1, mtimeMs: 1, sha256: "x" }, updatedAtIso: new Date().toISOString() },
				"auto",
			)
			expect(out.ok).to.equal(false)
		})

		it("a link added while a request was out turns the update into a flag", async () => {
			await load()
			let release: () => void = () => {}
			const gate = new Promise<void>((resolve) => (release = resolve))
			h.fetchHook = async () => {
				h.fetchHook = undefined
				await gate
			}
			await fsp.writeFile(file, fc(2))
			h.emit(file)
			await until(() => h.requests.length === 1)
			h.layers.set(
				layer().id,
				MapLayer.create({ ...layer(), metadata: { ...layer().metadata, _run_id: "dfetch.1.2.late0001" } }),
			)
			release()
			expect(await until(() => layer().metadata.source_status === "source_changed")).to.equal(true)
			expect(layer().geojson).to.equal(fc(1))
		})

		it("Use new file replaces the content, removes the link, and says which run it was", async () => {
			await load({ _run_id: "dfetch.1.2.abcd1234", tool: "extract_rivers", study_id: "prj_x", uncertainty: "ci95" })
			await fsp.writeFile(file, fc(2))
			h.emit(file)
			await until(() => layer().metadata.source_status === "source_changed")
			const out = await h.watch.useNewFile(layer().id)
			expect(out.ok).to.equal(true)
			expect(await until(() => layer().geojson === fc(2))).to.equal(true)
			const meta = layer().metadata
			expect(meta._run_id).to.equal(undefined)
			expect(meta.tool).to.equal(undefined)
			expect(meta.study_id).to.equal(undefined)
			expect(meta.uncertainty).to.equal(undefined)
			expect(meta._prior_run_id).to.equal("dfetch.1.2.abcd1234")
			expect(meta.source_status).to.equal("current")
			expect(meta.source_seen_sha256).to.equal(undefined)
			const report = h.reports.find((r) => r.kind === "updated")
			expect(report).to.include({ mode: "use_new_file", priorRun: "dfetch.1.2.abcd1234" })
		})

		it("a layer linked only by study or claim loses that link too when the user chooses the new file", async () => {
			await load({ claim_id: "c1" })
			await fsp.writeFile(file, fc(2))
			h.emit(file)
			await until(() => layer().metadata.source_status === "source_changed")
			await h.watch.useNewFile(layer().id)
			expect(await until(() => layer().geojson === fc(2))).to.equal(true)
			expect(layer().metadata.claim_id).to.equal(undefined)
		})

		it("the file going back to what the layer holds clears the flag", async () => {
			await load({ _run_id: "dfetch.1.2.abcd1234" })
			const original = layer().metadata
			await fsp.writeFile(file, fc(2))
			h.emit(file)
			await until(() => layer().metadata.source_status === "source_changed")
			await fsp.writeFile(file, fc(1))
			await fsp.utimes(file, new Date(Number(original.source_mtime_ms)), new Date(Number(original.source_mtime_ms)))
			h.emit(file)
			expect(await until(() => layer().metadata.source_status === "current")).to.equal(true)
			expect(layer().metadata.source_seen_sha256).to.equal(undefined)
		})

		it("a raster layer is flagged, not re-parsed", async () => {
			await load({}, { layerType: "raster", geojson: "" })
			await fsp.writeFile(file, fc(2))
			h.emit(file)
			expect(await until(() => layer().metadata.source_status === "source_changed")).to.equal(true)
			expect(h.requests.length).to.equal(0)
		})
	})

	describe("the panel", () => {
		it("closed: nothing is requested and nothing changes; the next open applies the change", async () => {
			h.panel.open = false
			await load()
			await fsp.writeFile(file, fc(2))
			h.emit(file)
			await wait(200)
			await h.watch.checkAll()
			expect(h.requests.length).to.equal(0)
			expect(layer().geojson).to.equal(fc(1))
			expect(layer().metadata.source_sha256).to.equal(undefined)
			h.panel.open = true
			await h.watch.checkAll()
			expect(await until(() => layer().geojson === fc(2))).to.equal(true)
		})

		it("a linked layer is flagged even while the panel is closed", async () => {
			h.panel.open = false
			await load({ _run_id: "dfetch.1.2.abcd1234" })
			await fsp.writeFile(file, fc(2))
			h.emit(file)
			expect(await until(() => layer().metadata.source_status === "source_changed")).to.equal(true)
		})

		it("closing with a request out cancels it without calling the file unreadable", async () => {
			await load()
			h.panel.answer = "never"
			await fsp.writeFile(file, fc(2))
			h.emit(file)
			await until(() => h.requests.length === 1)
			h.panel.open = false
			h.watch.cancelRequests()
			await wait(100)
			expect(layer().metadata.source_status).to.equal("current")
			expect(h.watch.isIdle()).to.equal(true)
		})

		it("a changed file found by looking (no event: the watcher dropped it) is applied by checkAll", async () => {
			await load()
			await fsp.writeFile(file, fc(2))
			await h.watch.checkAll()
			expect(await until(() => layer().geojson === fc(2))).to.equal(true)
		})

		it("looking again at an unchanged file reads nothing", async () => {
			await load()
			await h.watch.checkAll()
			await h.watch.checkAll()
			expect(h.requests.length).to.equal(0)
			expect(h.patches.length).to.equal(0)
		})

		it("a layer with no record of its file is left alone by a look, but an event is taken as a change", async () => {
			await load({ source_size_bytes: "", source_mtime_ms: "" })
			await fsp.writeFile(file, fc(2))
			await h.watch.checkAll()
			await wait(100)
			expect(h.requests.length).to.equal(0)
			h.emit(file)
			expect(await until(() => layer().geojson === fc(2))).to.equal(true)
		})
	})

	describe("restore: a file that changed while VS Code was closed", () => {
		it("a tool's layer with an absolute path and a recorded size and time is flagged by the first look, not redrawn", async () => {
			await load({ tool: "extract_rivers", _run_id: "dfetch.1.2.abcd1234", study_id: "prj_x", _hydrated: "1" })
			await fsp.writeFile(file, fc(2, "changed while closed"))
			await h.watch.checkAll()
			expect(layer().metadata.source_status).to.equal("source_changed")
			expect(layer().metadata._run_id).to.equal("dfetch.1.2.abcd1234")
			expect(layer().geojson).to.equal(fc(1))
		})

		it("nothing recorded: not checked, and not called changed", async () => {
			await load({ tool: "extract_rivers", _run_id: "dfetch.1.2.abcd1234", source_size_bytes: "", source_mtime_ms: "" })
			await fsp.writeFile(file, fc(2, "changed while closed"))
			await h.watch.checkAll()
			expect(layer().metadata.source_status).to.equal("current")
			expect(h.patches).to.deep.equal([])
		})

		it("an unlinked layer is brought up to date by the first look", async () => {
			await load({ _hydrated: "1" })
			await fsp.writeFile(file, fc(2, "changed while closed"))
			await h.watch.checkAll()
			expect(await until(() => layer().geojson === fc(2, "changed while closed"))).to.equal(true)
		})
	})

	describe("hash on arrival, same length", () => {
		it("a rewrite of the same length between the host's read and the page's is caught by the hash, not taken", async () => {
			await load()
			await fsp.writeFile(file, fc(2))
			h.fetchHook = async () => {
				h.fetchHook = undefined
				await fsp.writeFile(file, fc(3)) // same byte length as fc(2)
			}
			h.emit(file)
			expect(await until(() => layer().geojson === fc(3))).to.equal(true)
			expect(h.requests.length).to.equal(2)
			expect(layer().metadata.source_sha256).to.equal(sha(fc(3)))
		})
	})

	describe("a file too large to hash", () => {
		const small = { maxHashBytes: 10 }
		const open = async (meta: Record<string, string>) => {
			await h.cleanup()
			h = await makeHarness({ options: small })
			file = path.join(h.dir, "basin.geojson")
			await fsp.writeFile(file, fc(1))
			const past = new Date(Date.now() - 60_000)
			await fsp.utimes(file, past, past)
			addLayer(h, layerFor(file, fc(1), meta))
			await h.watch.sync()
		}
		it("is flagged from its size and time alone; never read, never updated", async () => {
			await open({})
			await fsp.writeFile(file, fc(2, "now different"))
			h.emit(file)
			expect(await until(() => layer().metadata.source_status === "source_changed")).to.equal(true)
			expect(layer().metadata.source_seen_size_bytes).to.equal(String(Buffer.byteLength(fc(2, "now different"))))
			expect(layer().geojson).to.equal(fc(1))
			expect(h.requests.length).to.equal(0)
			await h.watch.checkAll()
			expect(h.patches.filter((p) => p.metadata.source_status === "source_changed").length).to.equal(1)
		})
		it("with an evidence link, the same", async () => {
			await open({ _run_id: "dfetch.1.2.abcd1234" })
			await fsp.writeFile(file, fc(2, "now different"))
			await h.watch.checkAll()
			expect(layer().metadata.source_status).to.equal("source_changed")
			expect(layer().metadata._run_id).to.equal("dfetch.1.2.abcd1234")
			expect(h.requests.length).to.equal(0)
		})
		it("Use new file says it is too large rather than failing quietly", async () => {
			await open({ _run_id: "dfetch.1.2.abcd1234" })
			await fsp.writeFile(file, fc(2, "now different"))
			await h.watch.checkAll()
			const out = await h.watch.useNewFile(layer().id)
			expect(out).to.deep.include({ ok: false })
			expect((out as { reason: string }).reason).to.contain("too large")
		})
	})

	describe("Use new file is honoured only for a file that differs", () => {
		it("a layer that was never flagged, with a file that is the same, is refused", async () => {
			await load({ _run_id: "dfetch.1.2.abcd1234", source_sha256: sha(fc(1)) })
			const out = await h.watch.useNewFile(layer().id)
			expect(out.ok).to.equal(false)
			expect(h.requests.length).to.equal(0)
		})
		it("a layer not yet flagged but whose file differs from its hash is allowed", async () => {
			await load({ _run_id: "dfetch.1.2.abcd1234", source_sha256: sha(fc(1)) })
			await fsp.writeFile(file, fc(2))
			expect((await h.watch.useNewFile(layer().id)).ok).to.equal(true)
		})
	})

	describe("the page does not answer", () => {
		it("is not an unreadable file: the request is dropped, the layer stays current, the next look asks again", async () => {
			await h.cleanup()
			h = await makeHarness({ options: { requestTimeoutMs: 80 } })
			file = path.join(h.dir, "basin.geojson")
			await fsp.writeFile(file, fc(1))
			const past = new Date(Date.now() - 60_000)
			await fsp.utimes(file, past, past)
			addLayer(h, layerFor(file, fc(1)))
			await h.watch.sync()
			h.panel.answer = "never"
			await fsp.writeFile(file, fc(2))
			h.emit(file)
			await until(() => h.requests.length === 1)
			await wait(200)
			expect(layer().metadata.source_status).to.equal("current")
			expect(h.reports.some((r) => r.kind === "unreadable")).to.equal(false)
			h.panel.answer = "page"
			await h.watch.checkAll()
			expect(await until(() => layer().geojson === fc(2))).to.equal(true)
		})
	})

	describe("which paths are watched", () => {
		it("a path the map may not load (a scene's, a message's) gets no watcher and its events are ignored", async () => {
			h.denied.add(file)
			await load()
			expect(h.watchedFolders).to.deep.equal([])
			await fsp.writeFile(file, fc(2))
			h.emit(file)
			await h.watch.checkAll()
			await wait(150)
			expect(h.requests.length).to.equal(0)
			expect(layer().geojson).to.equal(fc(1))
		})

		it("a map file inside an open folder uses the workspace watcher, not one of its own", async () => {
			await load()
			expect(h.watchedFolders).to.deep.equal([])
		})

		it("a file outside the open folders, or of a kind the workspace watcher does not list, gets a non-recursive folder watcher", async () => {
			await h.cleanup()
			h = await makeHarness({ workspace: false })
			file = path.join(h.dir, "basin.geojson")
			await fsp.writeFile(file, fc(1))
			await load()
			expect(h.watchedFolders).to.deep.equal([h.dir])
			await h.cleanup()
			h = await makeHarness()
			file = path.join(h.dir, "points.csv")
			await fsp.writeFile(file, "lat,lon\n1,1\n")
			await load()
			expect(h.watchedFolders).to.deep.equal([h.dir])
		})

		it("a layer whose file the map may not load says it is not watched, once, and clears it when it becomes watched", async () => {
			h.denied.add(file)
			await load()
			expect(layer().metadata.source_watch).to.equal("not_watched")
			await h.watch.sync()
			expect(h.patches.filter((p) => p.metadata.source_watch === "not_watched").length).to.equal(1)
			h.denied.delete(file)
			await h.watch.sync()
			expect(layer().metadata.source_watch).to.equal(undefined)
		})

		it("beyond the folder limit the user is told, once", async () => {
			await h.cleanup()
			h = await makeHarness({ workspace: false, options: { maxFolderWatchers: 1 } })
			for (const name of ["a", "b"]) {
				const dir = path.join(h.dir, name)
				await fsp.mkdir(dir)
				const f = path.join(dir, "x.geojson")
				await fsp.writeFile(f, fc(1))
				addLayer(h, layerFor(f, fc(1), {}, { id: `user-${name}` }))
			}
			await h.watch.sync()
			await h.watch.sync()
			expect(h.watchedFolders.length).to.equal(1)
			expect(h.reports.filter((r) => r.kind === "watch_limit").length).to.equal(1)
		})

		it("a layer from a URL, or one whose path is gone from the map, is not watched", async () => {
			await load({ source_remote_url: "https://example.org/a.geojson" })
			expect(h.watchedFolders).to.deep.equal([])
			h.layers.clear()
			await h.watch.sync()
			await fsp.writeFile(file, fc(2))
			h.emit(file)
			await wait(100)
			expect(h.requests.length).to.equal(0)
		})

		it("watchers are dropped when the last layer in a folder leaves", async () => {
			await h.cleanup()
			h = await makeHarness({ workspace: false })
			file = path.join(h.dir, "basin.geojson")
			await fsp.writeFile(file, fc(1))
			const l = await load()
			h.layers.delete(l.id)
			await h.watch.sync()
			await fsp.writeFile(file, fc(2))
			h.emit(file) // nobody is listening
			await wait(80)
			expect(h.requests.length).to.equal(0)
		})
	})
})
