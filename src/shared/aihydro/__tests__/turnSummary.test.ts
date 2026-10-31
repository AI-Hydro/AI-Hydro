import { expect } from "chai"
import type { AiHydroMessage } from "../../ExtensionMessage"
import { summarizeTurn } from "../turnSummary"

const say = (ts: number, s: string, text: string): AiHydroMessage => ({ ts, type: "say", say: s as never, text })

describe("summarizeTurn", () => {
	it("counts distinct runs, claims and written files since the last user message only", () => {
		const msgs: AiHydroMessage[] = [
			say(1, "task", "q"),
			say(2, "mcp_server_response", '{"_run_id":"old-run"}'),
			say(3, "user_feedback", "again"),
			say(4, "mcp_server_response", '{"_run_id":"r1","claim_id":"c1"}'),
			say(5, "mcp_server_response", '{"_run_id":"r1"}'),
			say(6, "tool", JSON.stringify({ tool: "editedExistingFile", path: "a.py" })),
			say(7, "tool", JSON.stringify({ tool: "readFile", path: "b.py" })),
			say(8, "tool", JSON.stringify({ tool: "editedExistingFile", path: "a.py" })),
			say(9, "completion_result", "see [run:r2#x] and [claim:c1] and [claim:c2]"),
		]
		expect(summarizeTurn(msgs, 9)).to.deep.equal({
			runIds: ["r1", "r2"],
			claimIds: ["c1", "c2"],
			filesChanged: ["a.py"],
		})
	})
	it("is empty for a turn with no machinery", () => {
		expect(summarizeTurn([say(1, "task", "q"), say(2, "completion_result", "hi")], 2)).to.deep.equal({
			runIds: [],
			claimIds: [],
			filesChanged: [],
		})
	})
	it("ignores markers in the answer's code, like the inline chips do", () => {
		const answer = "ok [claim:c1] and `see [run:rx#p]`\n```\n[claim:c9]\n```\n`[run:r2#q]`"
		const r = summarizeTurn([say(1, "task", "q"), say(2, "completion_result", answer)], 2)
		expect(r.claimIds).to.deep.equal(["c1"])
		expect(r.runIds).to.deep.equal(["r2"])
	})
	it("counts a run the answer names without #path (so it never says 'no runs' beside a run id), but not code", () => {
		const answer = "area 774.15 km² [run:watershed.0b12] and [run:a.b#key_outputs.x] and `[run:in.code]` plus [run:2nd-run]"
		const r = summarizeTurn([say(1, "task", "q"), say(2, "completion_result", answer)], 2)
		expect(r.runIds).to.have.members(["a.b", "watershed.0b12", "2nd-run"])
		expect(r.runIds).to.have.length(3)
	})
})
