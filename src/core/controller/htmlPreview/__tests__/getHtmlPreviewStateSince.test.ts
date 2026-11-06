import { HtmlPreviewItem, HtmlPreviewStateRequest } from "@shared/proto/cline/html_preview"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { getHtmlPreviewStateSince } from "../getHtmlPreviewStateSince"

const item = (id: string, hash: string, html = `<p>${id}</p>`) =>
	HtmlPreviewItem.create({ id, contentHash: hash, htmlContent: html, metadata: { trustSource: "installed-pack" } })

describe("getHtmlPreviewStateSince", () => {
	let sandbox: sinon.SinonSandbox
	let controller: { getHtmlPreviews: sinon.SinonStub }

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		controller = { getHtmlPreviews: sandbox.stub() }
		sandbox.stub(console, "log")
	})
	afterEach(() => sandbox.restore())

	it("sends everything when the requester holds nothing", async () => {
		controller.getHtmlPreviews.returns([item("a", "h1"), item("b", "h2")])
		const result = await getHtmlPreviewStateSince(controller as never, HtmlPreviewStateRequest.create({}))
		expect(result.items.map((i) => i.htmlContent)).to.deep.equal(["<p>a</p>", "<p>b</p>"])
		expect(result.items.every((i) => i.metadata.contentOmitted === undefined)).to.equal(true)
	})

	it("omits content only for an id whose hash matches, and says so", async () => {
		controller.getHtmlPreviews.returns([item("a", "h1"), item("b", "h2"), item("c", "h3")])
		const request = HtmlPreviewStateRequest.create({
			known: [
				{ id: "a", contentHash: "h1" },
				{ id: "b", contentHash: "OLD" },
			],
		})
		const result = await getHtmlPreviewStateSince(controller as never, request)
		const byId = Object.fromEntries(result.items.map((i) => [i.id, i]))
		expect(byId.a.htmlContent).to.equal("")
		expect(byId.a.metadata.contentOmitted).to.equal("true")
		expect(byId.a.contentHash).to.equal("h1")
		expect(byId.a.metadata.trustSource).to.equal("installed-pack")
		// A different hash, and an item the requester does not hold, are sent in full.
		expect(byId.b.htmlContent).to.equal("<p>b</p>")
		expect(byId.c.htmlContent).to.equal("<p>c</p>")
		expect(result.itemCount).to.equal(3)
	})

	it("never omits an item that has no content hash", async () => {
		controller.getHtmlPreviews.returns([item("a", "")])
		const result = await getHtmlPreviewStateSince(
			controller as never,
			HtmlPreviewStateRequest.create({ known: [{ id: "a", contentHash: "" }] }),
		)
		expect(result.items[0].htmlContent).to.equal("<p>a</p>")
	})
})
