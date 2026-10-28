import { expect } from "chai"
import { setRecordedFirstPartyLauncher } from "@shared/aihydro/firstPartyServers"
import { afterEach, beforeEach, describe, it } from "mocha"
import { startPreviewAgentTask } from "@/core/htmlPreview/startPreviewAgentTask"
import { startLedgerAgentTask } from "@/core/ledger/startLedgerAgentTask"
import { listSessionIds } from "@/integrations/aihydro-session/sessionSurfaces"
import { CAPS_282, FakeBindingServer, LAUNCHER } from "@/integrations/aihydro-session/__tests__/fakeBindingServer"

const running = {
	taskState: { abort: false },
	messageStateHandler: { getAiHydroMessages: () => [{ say: "task" }, { ask: "command" }] },
}

function ctl(task: unknown) {
	const log: string[] = []
	const c: any = {
		task,
		clearTask: async () => void log.push("clearTask"),
		postStateToWebview: async () => {},
		initTask: async (...a: unknown[]) => {
			log.push("initTask")
			c.initArgs = a
		},
	}
	return { c, log }
}

describe("ledger and preview launchers keep a running chat unless the user confirms", () => {
	for (const [name, start, origin] of [
		["ledger", startLedgerAgentTask, "ledger"],
		["preview", startPreviewAgentTask, "preview"],
	] as const) {
		it(`${name}: declining touches nothing; confirming replaces and records origin '${origin}'`, async () => {
			const no = ctl(running)
			expect(await start(no.c, "go", { confirmReplace: async () => false, focusChat: async () => {} })).to.deep.include({
				ok: false,
				cancelled: true,
			})
			expect(no.log).to.deep.equal([])
			const yes = ctl(running)
			expect((await start(yes.c, "go", { confirmReplace: async () => true, focusChat: async () => {} })).ok).to.equal(true)
			expect(yes.log).to.deep.equal(["clearTask", "initTask"])
			expect(yes.c.initArgs[5]).to.deep.equal({ origin })
		})
	}
})

describe("listSessionIds says why a list is empty", () => {
	beforeEach(() => setRecordedFirstPartyLauncher(LAUNCHER as any))
	afterEach(() => setRecordedFirstPartyLauncher(undefined))
	const study = { id: "s1", label: "S1", workspace: "/w" }

	it("2.8.1 (no study list): the explicit version message, not an empty list", async () => {
		const r = await listSessionIds(new FakeBindingServer([study], null))
		expect(r.sessions).to.deep.equal([])
		expect(r.notice).to.equal("Study list needs AI-Hydro tools >= 2.8.2.")
	})
	it("not connected: says so", async () => {
		expect((await listSessionIds(new FakeBindingServer([study], CAPS_282, []))).notice).to.match(/not connected/)
	})
	it("2.8.2: the ids, no notice", async () => {
		expect(await listSessionIds(new FakeBindingServer([study]))).to.deep.equal({ sessions: ["s1"] })
	})
})
