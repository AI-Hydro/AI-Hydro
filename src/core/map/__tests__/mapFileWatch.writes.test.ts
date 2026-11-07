import { type ChildProcess, execFileSync, spawn } from "node:child_process"
import * as fs from "node:fs"
import * as fsp from "node:fs/promises"
import * as path from "node:path"
import { MapLayer } from "@shared/proto/cline/map"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { DEFAULT_WATCH_OPTIONS } from "../mapFileWatch"
import { addLayer, type Harness, layerFor, makeHarness, sha, until, wait } from "./fixtures/mapFileWatchHarness"

/**
 * Slice 2 acceptance: 20 scripted writes from another process (Python), one after another, in the three ways a tool or an
 * editor writes (in place, write-then-os.replace, delete-then-create). A loaded layer with no run link must hold each version
 * within 2 s with its id, style and place kept, and a layer with a run link must hold none of them.
 *
 * The folder events here come from Node's `fs.watch` on the scratch folder, standing in for the extension host's watcher
 * (this is a unit test: there is no VS Code). The second test drops every event, as a watcher may, and relies on the look
 * that runs when the panel is shown again.
 */
const WRITES = 20
const WITHIN_MS = 2000

function findPython(): string | undefined {
	for (const candidate of ["/opt/miniconda3/bin/python", "python3", "python"]) {
		try {
			execFileSync(candidate, ["-c", "import os"], { stdio: "ignore" })
			return candidate
		} catch {
			/* next */
		}
	}
	return undefined
}

const WRITER = `
import json, os, sys, time
target = sys.argv[1]
n = int(sys.argv[2])
def doc(i):
    return json.dumps({"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"n": i, "pad": "p" * (i * 7)}, "geometry": {"type": "Point", "coordinates": [i, i]}}]}, separators=(",", ":"))
def retry(fn):
    # Windows refuses to replace or remove a file another process has open for a moment; a real tool would try again.
    for _ in range(100):
        try:
            return fn()
        except PermissionError:
            time.sleep(0.02)
    return fn()
def write(path, text):
    with open(path, "w", newline="") as f:
        f.write(text)
for i in range(2, n + 2):
    mode = ("inplace", "replace", "delete_create")[i % 3]
    text = doc(i)
    if mode == "inplace":
        retry(lambda: write(target, text))
    elif mode == "replace":
        tmp = target + ".tmp"
        write(tmp, text)
        retry(lambda: os.replace(tmp, target))
    else:
        retry(lambda: os.remove(target))
        time.sleep(0.05)
        retry(lambda: write(target, text))
    sys.stdout.write("wrote %d %s %s\\n" % (i, mode, time.time()))
    sys.stdout.flush()
    sys.stdin.readline()
`

const docText = (i: number) =>
	JSON.stringify({
		type: "FeatureCollection",
		features: [
			{ type: "Feature", properties: { n: i, pad: "p".repeat(i * 7) }, geometry: { type: "Point", coordinates: [i, i] } },
		],
	})

describe("MapFileWatch: 20 writes from another process", function () {
	this.timeout(120_000)
	const python = findPython()
	let h: Harness
	let file: string
	let writer: ChildProcess | undefined
	let watcher: fs.FSWatcher | undefined

	beforeEach(async function () {
		if (!python) this.skip()
		// The shipped delays, not the shortened ones the other tests use.
		h = await makeHarness({ options: DEFAULT_WATCH_OPTIONS })
		file = path.join(h.dir, "basin.geojson")
		await fsp.writeFile(file, docText(1))
		const past = new Date(Date.now() - 60_000)
		await fsp.utimes(file, past, past)
		await fsp.writeFile(path.join(h.dir, "writer.py"), WRITER)
	})
	afterEach(async () => {
		watcher?.close()
		watcher = undefined
		writer?.kill()
		writer = undefined
		if (h) await h.cleanup()
	})

	/** Drive the writer: after each "wrote" line, `afterWrite` runs, then the writer is told to go on. */
	async function drive(afterWrite: (i: number, mode: string) => Promise<void>): Promise<void> {
		writer = spawn(python as string, [path.join(h.dir, "writer.py"), file, String(WRITES)], {
			stdio: ["pipe", "pipe", "inherit"],
		})
		let buffer = ""
		let resolveNext: ((line: string) => void) | undefined
		const lines: string[] = []
		writer.stdout?.on("data", (chunk: Buffer) => {
			buffer += chunk.toString()
			let at: number
			while ((at = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, at)
				buffer = buffer.slice(at + 1)
				if (resolveNext) {
					const r = resolveNext
					resolveNext = undefined
					r(line)
				} else lines.push(line)
			}
		})
		const next = () =>
			new Promise<string>((resolve) => (lines.length ? resolve(lines.shift() as string) : (resolveNext = resolve)))
		for (let k = 0; k < WRITES; k++) {
			const line = await next()
			const [, i, mode] = line.split(" ")
			await afterWrite(Number(i), mode)
			writer.stdin?.write("go\n")
		}
		await wait(0)
	}

	const layer = () => [...h.layers.values()][0]

	it("an unlinked layer holds every version within 2 s, with its id, style and place kept", async () => {
		const first = layerFor(file, docText(1))
		addLayer(h, first)
		addLayer(h, MapLayer.create({ id: "above", name: "above" }))
		await h.watch.sync()
		watcher = fs.watch(h.dir, (_event, name) => {
			if (name) h.emit(path.join(h.dir, name.toString()))
		})
		const latencies: number[] = []
		const missed: number[] = []
		await drive(async (i) => {
			const t0 = Date.now()
			const seen = await until(() => h.layers.get(first.id)?.metadata.source_sha256 === sha(docText(i)), WITHIN_MS)
			latencies.push(Date.now() - t0)
			if (!seen) missed.push(i)
		})
		const stored = h.layers.get(first.id) as MapLayer
		console.log(
			`      20 writes, watcher events: missed=${missed.length}, latency ms: max=${Math.max(...latencies)} median=${[...latencies].sort((a, b) => a - b)[10]}`,
		)
		expect(missed, `writes not seen within ${WITHIN_MS} ms`).to.deep.equal([])
		expect(stored.geojson).to.equal(docText(WRITES + 1))
		expect(stored.style).to.deep.equal(first.style)
		expect(stored.name).to.equal(first.name)
		expect(h.layers.size).to.equal(2)
		expect(h.order).to.deep.equal([first.id, "above"])
		expect(h.focusEvents).to.equal(0)
		expect(h.reports.filter((r) => r.kind === "missing" || r.kind === "unreadable")).to.deep.equal([])
	})

	it("with every event dropped, the look made when the panel is shown again finds each version within 2 s", async () => {
		const first = layerFor(file, docText(1))
		addLayer(h, first)
		await h.watch.sync()
		const missed: number[] = []
		await drive(async (i) => {
			// No event reaches the watcher. The panel is shown again: every loaded file is looked at.
			const t0 = Date.now()
			await h.watch.checkAll()
			const seen = await until(
				() => h.layers.get(first.id)?.metadata.source_sha256 === sha(docText(i)),
				WITHIN_MS - (Date.now() - t0),
			)
			if (!seen) missed.push(i)
		})
		console.log(`      20 writes, events dropped, focus look only: missed=${missed.length}`)
		expect(missed.length, `writes missed after the focus look: ${missed.join(",")}`).to.be.at.most(1)
		expect(h.layers.get(first.id)?.style).to.deep.equal(first.style)
	})

	it("a layer with a run link holds none of the 20 versions, and says its file changed", async () => {
		const linked = layerFor(file, docText(1), {
			_run_id: "dfetch.20261107.abc.deadbeef",
			tool: "delineate",
			study_id: "prj_1",
		})
		addLayer(h, linked)
		await h.watch.sync()
		watcher = fs.watch(h.dir, (_event, name) => {
			if (name) h.emit(path.join(h.dir, name.toString()))
		})
		await drive(async (i) => {
			await until(() => h.layers.get(linked.id)?.metadata.source_seen_sha256 === sha(docText(i)), WITHIN_MS)
			const now = h.layers.get(linked.id) as MapLayer
			expect(now.geojson, `content after write ${i}`).to.equal(docText(1))
			expect(now.metadata._run_id).to.equal("dfetch.20261107.abc.deadbeef")
			expect(now.metadata.source_status).to.equal("source_changed")
		})
		expect(h.requests.length).to.equal(0)
		await wait(50)
	})
})
