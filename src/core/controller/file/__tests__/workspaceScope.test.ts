import { expect } from "chai"
import * as fs from "fs"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { isInsideRoot } from "../workspaceScope"

describe("isInsideRoot (chips only for workspace files)", () => {
	let root: string
	let outside: string
	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "aihydro-ws-"))
		outside = fs.mkdtempSync(path.join(os.tmpdir(), "aihydro-out-"))
		fs.writeFileSync(path.join(root, "a.png"), "x")
		fs.writeFileSync(path.join(outside, "secret"), "x")
	})
	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true })
		fs.rmSync(outside, { recursive: true, force: true })
	})
	it("accepts files in the workspace, including not-yet-written ones", () => {
		expect(isInsideRoot(root, path.join(root, "a.png"))).to.equal(true)
		expect(isInsideRoot(root, path.join(root, "later.png"))).to.equal(true)
	})
	it("rejects absolute paths elsewhere and .. escapes", () => {
		expect(isInsideRoot(root, path.join(outside, "secret"))).to.equal(false)
		expect(isInsideRoot(root, path.resolve(root, "../etc/passwd"))).to.equal(false)
		expect(isInsideRoot(root, path.join(os.homedir(), ".ssh", "id_ed25519"))).to.equal(false)
	})
	it("rejects a symlink inside the workspace that points outside", function () {
		try {
			fs.symlinkSync(path.join(outside, "secret"), path.join(root, "link"))
		} catch {
			this.skip()
		}
		expect(isInsideRoot(root, path.join(root, "link"))).to.equal(false)
	})
})

import { isChipPathAllowed, isToolOutputPath, resolveChipPath } from "../workspaceScope"

describe("chip scope with tool-output locations and several roots", () => {
	let home: string
	let rootA: string
	let rootB: string
	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "aihydro-home-"))
		rootA = fs.mkdtempSync(path.join(os.tmpdir(), "aihydro-a-"))
		rootB = fs.mkdtempSync(path.join(os.tmpdir(), "aihydro-b-"))
	})
	afterEach(() => {
		for (const d of [home, rootA, rootB]) {
			fs.rmSync(d, { recursive: true, force: true })
		}
	})
	it("allows the real tool-output locations under AIHYDRO_HOME", () => {
		for (const p of ["sessions/s1/outputs/hydrograph.png", "exports/a.json", "models/m/x.nc", "data_jobs/j/r.json"]) {
			expect(isToolOutputPath(home, path.join(home, p)), p).to.equal(true)
		}
	})
	it("keeps the rest of AIHYDRO_HOME and ~/.ssh out", () => {
		for (const p of [
			"trust/allowed_signers",
			"approvals/x.json",
			"registry/claims.jsonl",
			"sessions/s1/session.json",
			"sessions/outputs",
		]) {
			expect(isToolOutputPath(home, path.join(home, p)), p).to.equal(false)
		}
		expect(isChipPathAllowed([rootA], home, path.join(os.homedir(), ".ssh", "id_ed25519"))).to.equal(false)
	})
	it("resolves a relative path against every workspace root, not just the first", () => {
		fs.writeFileSync(path.join(rootB, "plot.png"), "x")
		expect(resolveChipPath([rootA, rootB], home, "plot.png", true)).to.equal(path.join(rootB, "plot.png"))
		expect(resolveChipPath([rootA], home, "plot.png", true)).to.equal(undefined)
	})
	it("an absolute tool-output file gets a chip; an absolute file elsewhere does not", () => {
		fs.mkdirSync(path.join(home, "sessions", "s1", "outputs"), { recursive: true })
		const out = path.join(home, "sessions", "s1", "outputs", "map.png")
		fs.writeFileSync(out, "x")
		expect(resolveChipPath([rootA], home, out, true)).to.equal(out)
		expect(resolveChipPath([rootA], home, path.join(home, "trust", "allowed_signers"), false)).to.equal(undefined)
	})
})
