import { readFile } from "node:fs/promises"
import path from "node:path"
import { expect } from "chai"
import { describe, it } from "mocha"
import { applyPendingAsk, HAS_PENDING_ASK_CONTEXT } from "../pendingAskSink"

async function pkg(): Promise<any> {
	return JSON.parse(await readFile(path.resolve(process.cwd(), "package.json"), "utf8"))
}

describe("aihydro.focusPendingPrompt contribution (W2-E2, C-2)", () => {
	it("is a declared command shown in the palette only while a prompt is pending", async () => {
		const p = await pkg()
		const cmd = p.contributes.commands.find((c: any) => c.command === "aihydro.focusPendingPrompt")
		expect(cmd, "command declared").to.not.equal(undefined)
		expect(cmd.title).to.be.a("string")
		const palette = p.contributes.menus.commandPalette.filter((e: any) => e.command === "aihydro.focusPendingPrompt")
		expect(palette).to.have.length(1)
		expect(palette[0].when).to.equal(HAS_PENDING_ASK_CONTEXT)
		expect(HAS_PENDING_ASK_CONTEXT).to.equal("aihydro.hasPendingAsk")
	})

	it("has no default keybinding", async () => {
		const p = await pkg()
		const bound = (p.contributes.keybindings ?? []).filter((k: any) => k.command === "aihydro.focusPendingPrompt")
		expect(bound).to.deep.equal([])
	})
})

describe("applyPendingAsk", () => {
	it("sets the badge and the context key, then clears both", () => {
		const target: any = {}
		const ctx: [string, boolean][] = []
		applyPendingAsk(target, { ts: 1, ask: "command", tooltip: "waiting" }, (k, v) => void ctx.push([k, v]))
		expect(target.badge).to.deep.equal({ value: 1, tooltip: "waiting" })
		applyPendingAsk(target, undefined, (k, v) => void ctx.push([k, v]))
		expect(target.badge).to.equal(undefined)
		expect(ctx).to.deep.equal([
			["aihydro.hasPendingAsk", true],
			["aihydro.hasPendingAsk", false],
		])
	})
})
