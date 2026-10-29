import { setRecordedFirstPartyLauncher } from "@shared/aihydro/firstPartyServers"
import { expect } from "chai"
import { createHash } from "crypto"
import * as fs from "fs"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { fakeServerEntry, LAUNCHER } from "@/integrations/aihydro-session/__tests__/fakeBindingServer"
import { dirProjectKey, getProjectKey, type ProjectKeyHub } from "../projectIdentity"

// Values computed with the tools server's own function:
//   "dir:" + hashlib.sha256(os.path.realpath(p).encode("utf-8")).hexdigest()   (ai_hydro/session/project_key.py)
// Windows values: Python ntpath semantics (abspath/normpath of a drive-qualified path; no case folding,
// which `project_key` does not do; `dir_key` in project_registry does, but it is a different function).
const WIN = process.platform === "win32"
const KNOWN = WIN ? "C:\\nonexistent-aihydro\\known\\path" : "/nonexistent-aihydro/known/path"
const KNOWN_KEY = WIN
	? "dir:b6668b69e18e15a0a48a9e28316114cc9b0673f1afe8200b19ba6767ceacf143"
	: "dir:78aa90ec2cbea598c947449887c588d002e3edccae682a958a42273df2c66c47"
const KNOWN_UNICODE = WIN ? "C:\\nonexistent-aihydro\\ünï\\proj\\" : "/nonexistent-aihydro/ünï/proj/"
const KNOWN_UNICODE_KEY = WIN
	? "dir:9393237825f14d758fe44a1435d8892288ef7b6fe1fc58dc0036249ba06ba206"
	: "dir:96ed8c89a37d30023f44cff8a757d7bf1b41a9f18a1861ae2946db7d5d5cbdc2"

function hubWith(body: unknown, opts: { connected?: boolean; reject?: boolean } = {}): ProjectKeyHub & { uris: string[] } {
	const uris: string[] = []
	return {
		uris,
		getServers: () => [fakeServerEntry(opts.connected === false ? { status: "disconnected" } : {})],
		readResource: async (_name: string, uri: string) => {
			uris.push(uri)
			if (opts.reject) {
				throw new Error("boom")
			}
			return { contents: [{ uri, text: JSON.stringify(body) }] } as any
		},
	}
}

describe("projectIdentity", () => {
	beforeEach(() => setRecordedFirstPartyLauncher(LAUNCHER as any))
	afterEach(() => setRecordedFirstPartyLauncher(undefined))

	it("dir key matches the tools server project_key byte for byte", async () => {
		expect(await dirProjectKey(KNOWN)).to.equal(KNOWN_KEY)
		expect(await dirProjectKey(KNOWN_UNICODE)).to.equal(KNOWN_UNICODE_KEY)
	})

	it("ignores a trailing separator like realpath does", async () => {
		expect(await dirProjectKey(KNOWN + path.sep)).to.equal(KNOWN_KEY)
	})

	it("resolves symlinks in the existing part of the path", async () => {
		const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pid-")))
		try {
			fs.mkdirSync(path.join(base, "real"))
			fs.symlinkSync(path.join(base, "real"), path.join(base, "link"))
			expect(await dirProjectKey(path.join(base, "link", "sub"))).to.equal(
				await dirProjectKey(path.join(base, "real", "sub")),
			)
		} finally {
			fs.rmSync(base, { recursive: true, force: true })
		}
	})

	it("keeps the input case of an existing directory (Python realpath does not canonicalise case)", async () => {
		const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pidcase-")))
		try {
			const dir = path.join(base, "MixedCase")
			fs.mkdirSync(dir)
			const flipped = path.join(base, "mixedcase")
			// Only meaningful on a case-insensitive filesystem (default macOS, Windows); a case-sensitive one has no such dir.
			if (!fs.existsSync(flipped)) {
				return
			}
			if (process.platform === "win32") {
				return // Windows canonicalises through GetFinalPathName, exactly as Python's ntpath.realpath does
			}
			expect(await dirProjectKey(flipped)).to.equal("dir:" + createHash("sha256").update(flipped, "utf8").digest("hex"))
		} finally {
			fs.rmSync(base, { recursive: true, force: true })
		}
	})

	it("returns the dir key without a hub", async () => {
		expect(await getProjectKey(KNOWN)).to.deep.equal({ key: KNOWN_KEY, kind: "dir" })
	})

	it("returns the prj_ id when the server has the project", async () => {
		const hub = hubWith({ found: true, project_id: "prj_01KV0000000000000000000000" })
		const got = await getProjectKey(KNOWN, hub)
		expect(got).to.deep.equal({ key: "prj_01KV0000000000000000000000", kind: "prj" })
		expect(hub.uris[0]).to.equal(`aihydro://project/by-dir?path=${encodeURIComponent(KNOWN)}`)
	})

	it("falls back to the dir key on a miss, a malformed id, an error or no connected server", async () => {
		const want = { key: KNOWN_KEY, kind: "dir" }
		expect(await getProjectKey(KNOWN, hubWith({ found: false, path: KNOWN }))).to.deep.equal(want)
		expect(await getProjectKey(KNOWN, hubWith({ found: true, project_id: "not-a-project" }))).to.deep.equal(want)
		expect(await getProjectKey(KNOWN, hubWith({}, { reject: true }))).to.deep.equal(want)
		expect(await getProjectKey(KNOWN, hubWith({ found: true, project_id: "prj_ABC" }, { connected: false }))).to.deep.equal(
			want,
		)
	})
})
