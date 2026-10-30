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
