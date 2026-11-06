import type { HtmlPreviewItem } from "@shared/proto/cline/html_preview"
import { describe, expect, it } from "vitest"
import { hydrateOmittedContent } from "../htmlPreviewReconcile"

const item = (id: string, hash: string, html: string, metadata: Record<string, string> = {}) =>
	({ id, contentHash: hash, htmlContent: html, metadata }) as HtmlPreviewItem

describe("hydrateOmittedContent", () => {
	it("passes full items through untouched", () => {
		const a = item("a", "h1", "<p>a</p>")
		expect(hydrateOmittedContent([a], new Map())).toEqual([a])
	})

	it("restores omitted content from the held copy with the same hash and drops the marker", () => {
		const held = new Map([["a", item("a", "h1", "<p>held</p>")]])
		const omitted = item("a", "h1", "", { contentOmitted: "true", trustSource: "installed-pack" })
		const [out] = hydrateOmittedContent([omitted], held) as HtmlPreviewItem[]
		expect(out.htmlContent).toBe("<p>held</p>")
		expect(out.metadata).toEqual({ trustSource: "installed-pack" })
	})

	it("returns null when an omitted item is not held or the hash differs", () => {
		const omitted = item("a", "h1", "", { contentOmitted: "true" })
		expect(hydrateOmittedContent([omitted], new Map())).toBeNull()
		expect(hydrateOmittedContent([omitted], new Map([["a", item("a", "OTHER", "<p>x</p>")]]))).toBeNull()
	})
})
