import { StringRequest } from "@shared/proto/cline/common"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { applySidebarView, SIDEBAR_VIEW_CONTEXT } from "../../../../hosts/vscode/sidebarViewSink"
import { setSidebarView } from "../setSidebarView"
import {
	getSidebarView,
	parseSidebarView,
	resetSidebarView,
	SIDEBAR_VIEWS,
	type SidebarView,
	setSidebarViewSink,
} from "../sidebarView"

describe("sidebarView (Nav-3)", () => {
	let seen: SidebarView[]
	beforeEach(() => {
		resetSidebarView()
		seen = []
		setSidebarViewSink((v) => seen.push(v))
		seen.length = 0
	})
	afterEach(() => {
		resetSidebarView()
		setSidebarViewSink(undefined)
	})

	it("the webview's report becomes the current view and reaches the sink", async () => {
		await setSidebarView({} as any, StringRequest.create({ value: "history" }))
		expect(getSidebarView()).to.equal("history")
		expect(seen).to.deep.equal(["history"])
		await setSidebarView({} as any, StringRequest.create({ value: "chat" }))
		expect(getSidebarView()).to.equal("chat")
	})

	it("every view the webview can show is accepted; anything else is the chat, so no button stays toggled", () => {
		for (const view of SIDEBAR_VIEWS) {
			expect(parseSidebarView(view)).to.equal(view)
		}
		expect(parseSidebarView("studio")).to.equal("chat")
		expect(parseSidebarView("")).to.equal("chat")
		expect(parseSidebarView(undefined)).to.equal("chat")
	})

	it("a newly registered sink draws the current view (a re-resolved sidebar)", async () => {
		await setSidebarView({} as any, StringRequest.create({ value: "settings" }))
		const late: SidebarView[] = []
		setSidebarViewSink((v) => late.push(v))
		expect(late).to.deep.equal(["settings"])
	})

	it("a sink that throws does not break navigation", async () => {
		setSidebarViewSink(() => {
			throw new Error("context key failed")
		})
		await setSidebarView({} as any, StringRequest.create({ value: "mcp" }))
		expect(getSidebarView()).to.equal("mcp")
	})

	it("the VS Code sink writes the aihydro.sidebarView context key", () => {
		const calls: [string, string][] = []
		applySidebarView("skills", (key, value) => {
			calls.push([key, value])
		})
		expect(calls).to.deep.equal([[SIDEBAR_VIEW_CONTEXT, "skills"]])
		expect(SIDEBAR_VIEW_CONTEXT).to.equal("aihydro.sidebarView")
	})
})
