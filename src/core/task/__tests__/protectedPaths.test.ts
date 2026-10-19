import { expect } from "chai"
import * as fs from "fs"
import { describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { computeProtectedRoots, isProtectedPath } from "../protectedPaths"

describe("protected paths for agent file writes (B3)", () => {
	// Paths under the OS temp directory, which always resolves quickly (some systems auto-mount /home and /net).
	const base = path.join(os.tmpdir(), "aihydro-protected-test")
	const home = path.join(base, "home", "u")
	const storage = path.join(home, ".config", "Code", "User", "globalStorage", "aihydro.ai-hydro")
	const configuredHome = path.join(base, "data", "aihydro")
	const roots = computeProtectedRoots({ homeDir: home, globalStoragePath: storage, aihydroHome: configuredHome })

	it("protects the MCP settings file and the extension settings/state directories (global storage)", () => {
		expect(isProtectedPath(path.join(storage, "settings", "aihydro_mcp_settings.json"), roots)).to.equal(true)
		expect(isProtectedPath(path.join(storage, "state", "taskHistory.json"), roots)).to.equal(true)
		expect(isProtectedPath(storage, roots)).to.equal(true)
	})

	it("protects $AIHYDRO_HOME/{approvals,trust,registry} for both the default and the configured home", () => {
		for (const aihydroHome of [path.join(home, ".aihydro"), configuredHome]) {
			for (const sub of ["approvals", "trust", "registry"]) {
				expect(isProtectedPath(path.join(aihydroHome, sub, "x.json"), roots), `${aihydroHome}/${sub}`).to.equal(true)
			}
		}
	})

	it("protects ~/.ssh", () => {
		expect(isProtectedPath(path.join(home, ".ssh", "id_ed25519"), roots)).to.equal(true)
		expect(isProtectedPath(path.join(home, ".ssh"), roots)).to.equal(true)
	})

	it("does not protect ordinary or look-alike paths", () => {
		expect(isProtectedPath(path.join(home, "project", "src", "a.ts"), roots)).to.equal(false)
		expect(isProtectedPath(path.join(home, ".sshx", "key"), roots)).to.equal(false)
		expect(isProtectedPath(path.join(home, ".aihydro", "sessions", "s.json"), roots)).to.equal(false) // only the three state dirs
		expect(isProtectedPath(path.join(home, ".aihydro", "approvals-notes.txt"), roots)).to.equal(false)
	})

	it("sees through a symlink in the workspace that points into a protected directory", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "protected-"))
		try {
			const secret = path.join(dir, "home", ".ssh")
			fs.mkdirSync(secret, { recursive: true })
			const workspace = path.join(dir, "work")
			fs.mkdirSync(workspace)
			fs.symlinkSync(secret, path.join(workspace, "innocent"))
			const symRoots = computeProtectedRoots({ homeDir: path.join(dir, "home") })
			expect(isProtectedPath(path.join(workspace, "innocent", "authorized_keys"), symRoots)).to.equal(true)
			expect(isProtectedPath(path.join(workspace, "other.txt"), symRoots)).to.equal(false)
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})
})
