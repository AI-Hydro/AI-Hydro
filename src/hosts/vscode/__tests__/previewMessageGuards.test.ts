import * as path from "node:path"
import { expect } from "chai"
import { describe, it } from "mocha"
import {
	type ArtifactLookup,
	decideActiveCourse,
	decideModuleState,
	decidePreviewEvent,
	decideSaveDocument,
	decideShellReady,
} from "../previewMessageGuards"

const ROOT = path.resolve(path.sep, "ws", "course")
const FILE = path.join(ROOT, "m1", "module.html")

function lookup(opts: { allowed?: string[]; meta?: Record<string, string> } = {}): ArtifactLookup {
	const known: Record<string, string> = { file_a: FILE, file_b: path.join(ROOT, "m2", "module.html") }
	return {
		fsPath: (id) => known[id],
		metadata: () => opts.meta,
		canExecute: (id) => (opts.allowed ?? []).includes(id),
	}
}

const ev = (over: Record<string, unknown> = {}) => ({
	artifactId: "file_a",
	kind: "user.interaction",
	payloadJson: JSON.stringify({ moduleId: "victim-module", cellId: "c1" }),
	source: "bridge",
	timestampMs: 5,
	...over,
})

describe("decidePreviewEvent", () => {
	it("drops events for an unknown artifact", () => {
		expect(decidePreviewEvent(ev({ artifactId: "nope" }), lookup(), new Map())).to.equal(null)
		expect(decidePreviewEvent(ev({ artifactId: undefined }), lookup(), new Map())).to.equal(null)
	})

	it("ignores the module id inside the payload and files the event under the host artifact id", () => {
		const d = decidePreviewEvent(ev(), lookup({ allowed: ["file_a"] }), new Map())
		expect(d?.event.moduleId).to.equal("file_a")
		const payload = JSON.parse(d?.event.payloadJson ?? "{}")
		expect(payload.moduleId).to.equal("file_a")
		expect(payload.module_id).to.equal("file_a")
	})

	it("tags events from a document that is not allowed as untrusted data, whatever source it claims", () => {
		const d = decidePreviewEvent(ev({ source: "kernel" }), lookup(), new Map())
		expect(d?.event.source).to.equal("untrusted-document")
	})

	it("keeps the claimed source for an allowed document", () => {
		expect(decidePreviewEvent(ev({ source: "bridge" }), lookup({ allowed: ["file_a"] }), new Map())?.event.source).to.equal(
			"bridge",
		)
	})

	it("never moves identity for a document that is not allowed", () => {
		const manifest = ev({ kind: "manifest.loaded", payloadJson: JSON.stringify({ id: "dem-to-twi" }) })
		const d = decidePreviewEvent(manifest, lookup(), new Map())
		expect(d?.identityMove).to.equal(undefined)
		expect(d?.event.moduleId).to.equal("file_a")
	})

	it("lets an allowed document name itself, but not claim an id another artifact holds", () => {
		const manifest = ev({ kind: "manifest.loaded", payloadJson: JSON.stringify({ id: "dem-to-twi" }) })
		const ok = decidePreviewEvent(manifest, lookup({ allowed: ["file_a"] }), new Map())
		expect(ok?.identityMove).to.deep.equal({ rawId: "file_a", canonicalId: "dem-to-twi" })
		expect(ok?.event.moduleId).to.equal("dem-to-twi")
		const taken = decidePreviewEvent(manifest, lookup({ allowed: ["file_a"] }), new Map([["file_b", "dem-to-twi"]]))
		expect(taken?.identityMove).to.equal(undefined)
		expect(taken?.event.moduleId).to.equal("file_a")
	})

	it("rejects an unsafe canonical id", () => {
		const manifest = ev({ kind: "manifest.loaded", payloadJson: JSON.stringify({ id: "../../x" }) })
		expect(decidePreviewEvent(manifest, lookup({ allowed: ["file_a"] }), new Map())?.identityMove).to.equal(undefined)
	})

	it("normalises an odd kind and an oversize payload", () => {
		expect(decidePreviewEvent(ev({ kind: "x'; DROP" }), lookup(), new Map())?.event.kind).to.equal("unknown")
		const big = decidePreviewEvent(ev({ payloadJson: "x".repeat(300 * 1024) }), lookup(), new Map())
		expect(JSON.parse(big?.event.payloadJson ?? "{}").truncated).to.equal(true)
	})
})

describe("decideSaveDocument", () => {
	it("writes only to the artifact's registered file", () => {
		const d = decideSaveDocument({ artifactId: "file_a", filePath: FILE, html: "<p>x</p>" }, lookup())
		expect(d).to.deep.equal({ ok: true, fsPath: FILE, html: "<p>x</p>" })
		expect(decideSaveDocument({ artifactId: "file_a", html: "<p>x</p>" }, lookup())).to.include({ ok: true })
	})

	it("refuses another path, an unknown artifact, and empty or oversize html", () => {
		expect(decideSaveDocument({ artifactId: "file_a", filePath: "/etc/passwd", html: "x" }, lookup())).to.include({
			ok: false,
		})
		expect(
			decideSaveDocument(
				{ artifactId: "file_a", filePath: path.join(ROOT, "m1", "..", "..", "evil.html"), html: "x" },
				lookup(),
			),
		).to.include({ ok: false })
		expect(decideSaveDocument({ artifactId: "ghost", filePath: FILE, html: "x" }, lookup())).to.include({ ok: false })
		expect(decideSaveDocument({ artifactId: "file_a", html: "" }, lookup())).to.include({ ok: false })
		expect(decideSaveDocument({ filePath: FILE, html: "x" }, lookup())).to.include({ ok: false })
	})
})

describe("decideActiveCourse", () => {
	const msg = (over: Record<string, unknown> = {}) => ({
		artifactId: "file_a",
		courseId: "c",
		coursePath: path.join(ROOT, "course.json"),
		courseRoot: ROOT,
		...over,
	})

	it("accepts a course.json whose folder contains the artifact", () => {
		expect(decideActiveCourse(msg(), lookup())).to.include({ ok: true, courseRoot: ROOT })
	})

	it("refuses a pointer that does not contain the artifact, is not course.json, or has a mismatched root", () => {
		expect(
			decideActiveCourse(
				msg({ courseRoot: path.resolve(path.sep, "other"), coursePath: path.resolve(path.sep, "other", "course.json") }),
				lookup(),
			),
		).to.deep.equal({ ok: false })
		expect(decideActiveCourse(msg({ coursePath: path.join(ROOT, "passwd") }), lookup())).to.deep.equal({ ok: false })
		expect(decideActiveCourse(msg({ courseRoot: path.join(ROOT, "m1") }), lookup())).to.deep.equal({ ok: false })
		expect(decideActiveCourse(msg({ artifactId: "ghost" }), lookup())).to.deep.equal({ ok: false })
	})
})

describe("decideModuleState", () => {
	it("requires the key to match the host record", () => {
		expect(decideModuleState({ artifactId: "file_a", action: "get", moduleKey: FILE }, lookup())).to.include({ ok: true })
		expect(decideModuleState({ artifactId: "file_a", action: "get", moduleKey: "/somewhere/else" }, lookup())).to.include({
			ok: false,
		})
		expect(decideModuleState({ action: "get", moduleKey: FILE }, lookup())).to.include({ ok: false })
	})

	it("lets only an allowed document write, and clamps what it writes", () => {
		const set = {
			artifactId: "file_a",
			action: "set",
			moduleKey: FILE,
			values: { a: "1", b: 2, ["k".repeat(300)]: "x", big: "y".repeat(20000) },
		}
		expect(decideModuleState(set, lookup())).to.include({ ok: false })
		const ok = decideModuleState(set, lookup({ allowed: ["file_a"] }))
		expect(ok).to.deep.equal({ ok: true, values: { a: "1" } })
	})

	it("rejects a pack scope that disagrees with the artifact's host metadata", () => {
		const meta = { learningPackId: "p", learningPackCourseId: "c", learningPackEdition: "student", learningPackModuleId: "m" }
		const scope = { packId: "p", courseId: "c", edition: "student", moduleId: "m" }
		const base = { artifactId: "file_a", action: "get", moduleKey: FILE }
		expect(decideModuleState({ ...base, learningPackScope: scope }, lookup({ meta }))).to.include({ ok: true })
		expect(decideModuleState({ ...base, learningPackScope: { ...scope, packId: "other" } }, lookup({ meta }))).to.include({
			ok: false,
		})
		expect(decideModuleState({ ...base, learningPackScope: scope }, lookup())).to.include({ ok: false })
	})
})

describe("decideShellReady", () => {
	it("re-pushes only for the current document's token", () => {
		expect(decideShellReady({ token: "tok-2" }, "tok-2")).to.equal("repush")
	})

	it("ignores a stale document whose token was replaced by a newer load", () => {
		// Two mounts: the host minted tok-1, then tok-2 when it reassigned the shell HTML.
		expect(decideShellReady({ token: "tok-1" }, "tok-2")).to.equal("ignore")
		expect(decideShellReady({ token: "tok-2" }, "tok-2")).to.equal("repush")
	})

	it("ignores missing, non-string or empty tokens (a document that cannot read the token)", () => {
		expect(decideShellReady({}, "tok")).to.equal("ignore")
		expect(decideShellReady({ token: 7 }, "tok")).to.equal("ignore")
		expect(decideShellReady({ token: "" }, "")).to.equal("ignore")
	})

	it("serves a repeated request after a lost first reply", () => {
		expect(decideShellReady({ token: "tok" }, "tok")).to.equal("repush")
		expect(decideShellReady({ token: "tok" }, "tok")).to.equal("repush")
	})
})
