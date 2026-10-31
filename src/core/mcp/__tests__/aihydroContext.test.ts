import { expect } from "chai"
import { describe, it } from "mocha"
import { AIHYDRO_CONTEXT_META_KEY, buildAiHydroCallContext } from "../aihydroContext"

describe("buildAiHydroCallContext", () => {
	it("carries model_id_returned in _meta when the provider reported one", () => {
		const ctx = buildAiHydroCallContext({ a: 1 }, "chat-1", "/ws", "claude-opus-5-5-20261001")
		const meta = ctx.meta[AIHYDRO_CONTEXT_META_KEY] as Record<string, unknown>
		expect(meta.model_id_returned).to.equal("claude-opus-5-5-20261001")
		expect(meta.chat_id).to.equal("chat-1")
		expect(ctx.args).to.include({ a: 1, _chat_id: "chat-1", _workspace: "/ws" })
		// the model id is provenance metadata, not a tool argument
		expect(ctx.args).to.not.have.property("model_id_returned")
	})

	it("omits model_id_returned when the provider did not report a model", () => {
		const meta = buildAiHydroCallContext(undefined, "c", undefined).meta[AIHYDRO_CONTEXT_META_KEY] as Record<string, unknown>
		expect(meta).to.not.have.property("model_id_returned")
	})

	it("the main agent's context carries no agent block and is unchanged", () => {
		const { meta, args } = buildAiHydroCallContext({ a: 1 }, "chat-1", "/ws", "model-x", "prj_1")
		expect(meta[AIHYDRO_CONTEXT_META_KEY]).to.deep.equal({
			chat_id: "chat-1",
			workspace: "/ws",
			client: "vscode",
			project_id: "prj_1",
			model_id_returned: "model-x",
		})
		expect(args).to.deep.equal({ a: 1, _chat_id: "chat-1", _workspace: "/ws" })
	})

	it("a subagent's context adds the agent identity and leaves chat_id and client alone", () => {
		const agent = { agent_id: "sa_1", parent_agent_id: "chat-1", role: "explorer" }
		const { meta } = buildAiHydroCallContext(undefined, "chat-1", "/ws", undefined, undefined, agent)
		expect(meta[AIHYDRO_CONTEXT_META_KEY]).to.deep.equal({ chat_id: "chat-1", workspace: "/ws", client: "vscode", agent })
	})
})
