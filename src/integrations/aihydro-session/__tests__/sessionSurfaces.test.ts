import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect } from "chai"
import {
	LatestResearchRequest,
	parseResearchSnapshot,
	RESEARCH_SNAPSHOT_TEMPLATE,
	type ResearchSnapshot,
	readResearchSnapshot,
	type SnapshotBackend,
} from "../researchSnapshot"
import { loadClaimSurface, loadExperimentSurface, loadReplaySurface, resolveSessionJsonPath } from "../sessionSurfaces"

function snapshot(): ResearchSnapshot {
	return {
		schema_version: 1,
		session_id: "study",
		session_path: "/tmp/study.json",
		source: "session",
		run_log_source: "sqlite",
		claims: {},
		experiments: {},
		warnings: [],
		runs: ["first", "second"].map((id, index) => ({
			run_id: id,
			session_id: "study",
			tool_name: "evaluate",
			timestamp: `2026-01-0${index + 1}`,
			key_outputs: { nse: index ? 0.8 : 0.5 },
			inputs: { period: "2000-2001" },
			evidence: { schema_version: 1, uncertainty: { nse: { value: index ? 0.8 : 0.5 } } },
		})),
	}
}

function backend(value = snapshot()): SnapshotBackend {
	return {
		getServers: () => [
			{
				name: "configured-hydrology",
				status: "connected",
				resourceTemplates: [{ uriTemplate: RESEARCH_SNAPSHOT_TEMPLATE }],
			},
		],
		readResource: async (_name, uri) => ({ contents: [{ uri, text: JSON.stringify(value) }] }),
	}
}

async function rejects(promise: Promise<unknown>, message: string) {
	let failure: unknown
	try {
		await promise
	} catch (error) {
		failure = error
	}
	expect(failure).to.be.instanceOf(Error)
	expect(String(failure)).to.contain(message)
}

describe("backend research surfaces", () => {
	it("preserves actual repeated-tool run IDs, inputs and evidence", async () => {
		const replay = await loadReplaySurface("study", async () => snapshot())
		expect(replay.entries.map((run) => run.run_id)).to.deep.equal(["first", "second"])
		expect(replay.entries.map((run) => run.key_outputs.nse)).to.deep.equal([0.5, 0.8])
		expect(replay.entries[0].inputs?.period).to.equal("2000-2001")
		expect(replay.entries[1].evidence?.uncertainty).to.deep.equal({ nse: { value: 0.8 } })
	})

	it("does not invent history when the backend has no run log", async () => {
		const value = { ...snapshot(), runs: [], run_log_source: "absent" as const, warnings: ["No retained run log"] }
		const replay = await loadReplaySurface("study", async () => value)
		expect(replay.entries).to.deep.equal([])
		expect(replay.warnings).to.deep.equal(["No retained run log"])
	})

	it("uses normalized backend experiment definitions and results", async () => {
		const value = snapshot()
		value.experiments = {
			exp_b: { defn: { name: "B" } },
			exp_a: {
				defn: { name: "A", metrics: ["nse"] },
				results: {
					status: "complete",
					cells: { basin: { nse: { value: 0.8, run_id: "second" } } },
				},
			},
		}
		const experiment = await loadExperimentSurface("study", "", async () => value)
		expect(experiment.experiment_id).to.equal("exp_a")
		expect(experiment.availableExperimentIds).to.deep.equal(["exp_a", "exp_b"])
		expect(experiment.results?.cells.basin.nse.run_id).to.equal("second")
	})

	it("distinguishes no experiments from a backend failure", async () => {
		await rejects(
			loadExperimentSurface("study", "", async () => snapshot()),
			"No experiments found",
		)
		await rejects(
			loadExperimentSurface("study", "", async () => {
				throw new Error("backend unavailable")
			}),
			"backend unavailable",
		)
	})

	it("preserves formal links and generates candidates only for actual unlinked runs", async () => {
		const value = snapshot()
		value.claims = {
			c1: { claim: "Synthetic result", status: "tested", evidence_spans: [{ source_type: "run", source_id: "first" }] },
		}
		const claims = await loadClaimSurface("study", async () => value)
		expect(claims.claims.map((claim) => claim.claimId)).to.deep.equal(["c1", "candidate:second"])
		expect(claims.claims[0].evidenceSpans[0].sourceId).to.equal("first")
	})

	it("keeps supported claims without evidence visibly flagged for review", async () => {
		const value = snapshot()
		value.claims = { c1: { claim: "Unsupported assertion", status: "supported" } }
		const surface = await loadClaimSurface("study", async () => value)
		expect(surface.claims[0].status).to.equal("weakly_supported")
		expect(surface.claims[0].limitations.join(" ")).to.contain("No evidence spans")
	})

	it("preserves capsule provenance supplied by the backend", async () => {
		const value = {
			...snapshot(),
			source: "capsule" as const,
			session_path: "/tmp/capsule/session.json",
			run_log_source: "capsule_json" as const,
		}
		const replay = await loadReplaySurface("/tmp/capsule", async () => value)
		expect(replay.capsule_path).to.equal("/tmp/capsule")
		expect(replay.source).to.equal("capsule")
	})

	it("selects the backend by advertised capability, not server name", async () => {
		const value = await readResearchSnapshot(backend(), "study")
		expect(value.runs).to.have.length(2)
	})

	it("preserves path and Unicode through the resource reference", async () => {
		const client = backend()
		const target = "/tmp/हाइड्रो study/session.json"
		client.readResource = async (_name, uri) => {
			expect(Buffer.from(uri.split("/").at(-1)!, "base64url").toString("utf8")).to.equal(target)
			return { contents: [{ uri, text: JSON.stringify(snapshot()) }] }
		}
		await readResearchSnapshot(client, target)
	})

	it("does not silently select between multiple authoritative backends", async () => {
		const client = backend()
		const servers = client.getServers()
		client.getServers = () => [...servers, { ...servers[0], name: "other" }]
		await rejects(readResearchSnapshot(client, "study"), "Multiple")
	})

	it("reports disconnected or incompatible backends instead of empty results", async () => {
		const client = backend()
		client.getServers = () => []
		await rejects(readResearchSnapshot(client, "study"), "Connect or restart")
		expect(() => parseResearchSnapshot(JSON.stringify({ ...snapshot(), schema_version: 2 }))).to.throw("Incompatible")
	})

	it("surfaces storage errors and rejects mismatched resource URIs", async () => {
		const client = backend()
		client.readResource = async (_name, uri) => ({
			contents: [{ uri, text: JSON.stringify({ error: true, code: "RUN_LOG_UNREADABLE", message: "corrupt" }) }],
		})
		await rejects(readResearchSnapshot(client, "study"), "RUN_LOG_UNREADABLE")
		client.readResource = async () => ({ contents: [{ uri: "wrong", text: JSON.stringify(snapshot()) }] })
		await rejects(readResearchSnapshot(client, "study"), "matching research snapshot")
	})

	it("rejects duplicate or foreign run IDs", () => {
		const duplicate = snapshot()
		duplicate.runs.push(duplicate.runs[0])
		expect(() => parseResearchSnapshot(JSON.stringify(duplicate))).to.throw("Invalid persisted run")
		const foreign = snapshot()
		foreign.runs[0].session_id = "other"
		expect(() => parseResearchSnapshot(JSON.stringify(foreign))).to.throw("Invalid persisted run")
	})

	it("coalesces in-flight reads but refreshes completed snapshots", async () => {
		const client = backend()
		let calls = 0
		client.readResource = async (_name, uri) => {
			calls++
			return { contents: [{ uri, text: JSON.stringify(snapshot()) }] }
		}
		const first = readResearchSnapshot(client, "study")
		const second = readResearchSnapshot(client, "study")
		expect(first).to.equal(second)
		await Promise.all([first, second])
		await readResearchSnapshot(client, "study")
		expect(calls).to.equal(2)
	})

	it("ignores late requests while keeping comparison and primary lanes separate", () => {
		const requests = new LatestResearchRequest()
		const old = requests.start()
		const compare = requests.start("compare")
		const current = requests.start()
		expect(old()).to.equal(false)
		expect(current()).to.equal(true)
		expect(compare()).to.equal(true)
	})
})

const python = process.env.AIHYDRO_SURFACE_TEST_PYTHON
;(python ? describe : describe.skip)("Python-to-extension persisted snapshot integration", () => {
	let home: string
	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "aihydro-cross-language-"))
	})
	afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

	it("loads a Python-written current session, SQLite history and nested experiments", async () => {
		const script = `
import json, sys
from pathlib import Path
from ai_hydro.session import store
from ai_hydro.session.surfaces import read_research_snapshot
store._SESSIONS_DIR = Path(sys.argv[1]) / "sessions"
store._REPO_ROOT = Path(sys.argv[1])
s = store.HydroSession("actual")
for rid, score in [("run.one", 0.5), ("run.two", 0.8)]:
    s.put_result("model", "basin", "same", {"run_id": rid, "data": {"nse": score}, "meta": {"tool": "evaluate", "computed_at": rid}})
s.set("_experiments", {"exp": {"defn": {"name": "Actual nested experiment", "metrics": ["nse"]}, "results": {"status": "complete", "cells": {"basin": {"nse": {"value": 0.8, "run_id": "run.two"}}}}}})
s.claims["c1"] = {"claim": "Synthetic claim", "status": "tested", "evidence_spans": [{"source_type": "run", "source_id": "run.one"}]}
s.save()
print(json.dumps(read_research_snapshot("actual"), allow_nan=False))
`
		const text = execFileSync(python!, ["-c", script, home], { encoding: "utf8", timeout: 15000 })
		const value = parseResearchSnapshot(text)
		expect(resolveSessionJsonPath("actual", home)).to.equal(path.join(home, "sessions", "actual.json"))
		const reader = async () => value
		const replay = await loadReplaySurface("actual", reader)
		expect(replay.entries.filter((entry) => entry.tool_name === "evaluate").map((entry) => entry.run_id)).to.deep.equal([
			"run.one",
			"run.two",
		])
		const experiment = await loadExperimentSurface("actual", "exp", reader)
		expect(experiment.results?.cells.basin.nse.run_id).to.equal("run.two")
		const claims = await loadClaimSurface("actual", reader)
		expect(claims.claims[0].evidenceSpans[0].sourceId).to.equal("run.one")
	})
})

describe("research panel host integration", () => {
	it("does not post a late replay response over a newer selection", async () => {
		const { VscodeReplayProvider } = await import("../../../hosts/vscode/VscodeReplayProvider")
		const messages: Record<string, unknown>[] = []
		const panel = { webview: { postMessage: (message: Record<string, unknown>) => messages.push(message) } }
		const client = backend()
		let finishOld!: () => void
		client.readResource = async (_name, uri) => {
			const sid = Buffer.from(uri.split("/").at(-1)!, "base64url").toString("utf8")
			const value = snapshot()
			value.session_id = sid
			value.runs = value.runs.map((run) => ({ ...run, session_id: sid }))
			const response = { contents: [{ uri, text: JSON.stringify(value) }] }
			if (sid === "old")
				return new Promise((resolve) => {
					finishOld = () => resolve(response)
				})
			return response
		}
		const provider = VscodeReplayProvider as unknown as {
			controller: unknown
			currentPanel: unknown
			handleLoadReplay(panel: unknown, sessionId: string): Promise<void>
		}
		provider.controller = { mcpHub: client }
		provider.currentPanel = panel
		try {
			const old = provider.handleLoadReplay(panel, "old")
			await provider.handleLoadReplay(panel, "new")
			finishOld()
			await old
			expect(messages.map((message) => message.session_id)).to.deep.equal(["new"])
		} finally {
			provider.controller = undefined
			provider.currentPanel = undefined
		}
	})

	it("propagates ledger backend errors to the UI instead of an empty successful ledger", async () => {
		const { getLedgerState } = await import("../../../core/controller/ledger/getLedgerState")
		const client = backend()
		client.getServers = () => []
		await rejects(
			getLedgerState({ mcpHub: client } as Parameters<typeof getLedgerState>[0], { sessionId: "study" }),
			"Connect or restart",
		)
	})
})
