import { expect } from "chai"
import { describe, it } from "mocha"
import { hostAudienceRefusal, isAiHydroServerName, isHostAudienceTool } from "../aiHydroServer"
import { UseMcpToolHandler } from "../UseMcpToolHandler"

describe("isAiHydroServerName", () => {
	// Regression guard: a strict `=== "ai-hydro"` check silently disabled
	// _chat_id / _workspace injection for every server alias users actually
	// register, so chat↔study binding never fired and aihydro_chat_status
	// always reported bound:false. These aliases MUST all match.
	const aiHydroAliases = [
		"ai-hydro",
		"aihydro",
		"aihydro-tools",
		"ai-hydro-tools",
		"AI-Hydro",
		"AIHYDRO",
		"  aihydro-tools  ", // tolerant of incidental whitespace
	]

	for (const name of aiHydroAliases) {
		it(`matches ai-hydro family member: ${JSON.stringify(name)}`, () => {
			expect(isAiHydroServerName(name)).to.equal(true)
		})
	}

	const nonAiHydro = [
		"swatplus-builder",
		"pyhmt2d",
		"hydromind",
		"aihydro-evil-fork", // prefix lookalikes must not receive workspace/chat context
		"aihydro_core", // not a first-party name unless allowlisted
		"my-aihydro-fork", // does not START with the family prefix
		"hydro",
		"",
		undefined,
	]

	for (const name of nonAiHydro) {
		it(`does not match non-family server: ${JSON.stringify(name)}`, () => {
			expect(isAiHydroServerName(name)).to.equal(false)
		})
	}

	it("honours an explicit allowlist for other aliases", () => {
		expect(isAiHydroServerName("aihydro-core", ["aihydro-core"])).to.equal(true)
		expect(isAiHydroServerName("aihydro-core", [""])).to.equal(false)
		expect(isAiHydroServerName("AIHYDRO-CORE", [" aihydro-core "])).to.equal(true)
	})
})

describe("host-audience tools are refused to the model (X1-P1)", () => {
	const HOST = { "aihydro/audience": "host" }
	const connections = (serverName = "ai-hydro") => [
		{
			server: {
				name: serverName,
				status: "connected",
				tools: [
					{ name: "ensure_project", _meta: HOST },
					{ name: "set_project_default_study", _meta: HOST },
					{ name: "brand_new_host_op", _meta: HOST },
					{ name: "delineate_watershed", _meta: { tier: 1 } },
					{ name: "plain_tool" },
				],
			},
		},
	]

	it("keys off the annotation: any tool the server marks host is refused, nothing else", () => {
		for (const t of ["ensure_project", "set_project_default_study", "brand_new_host_op"]) {
			expect(isHostAudienceTool(connections(), "ai-hydro", t), t).to.equal(true)
		}
		for (const t of ["delineate_watershed", "plain_tool", "not_listed"]) {
			expect(isHostAudienceTool(connections(), "ai-hydro", t), t).to.equal(false)
		}
	})

	it("applies to the first-party server family only", () => {
		expect(isHostAudienceTool(connections("someone-else"), "someone-else", "ensure_project")).to.equal(false)
	})

	const run = async (toolName: string, args: Record<string, unknown>) => {
		const calls: string[] = []
		const said: string[] = []
		const config: any = {
			ulid: "01JCHAT",
			cwd: "/w",
			taskState: { consecutiveMistakeCount: 0 },
			services: {
				mcpHub: {
					connections: connections(),
					callTool: async (_s: string, t: string) => {
						calls.push(t)
						return { content: [{ type: "text", text: "{}" }] }
					},
				},
			},
			callbacks: {
				removeLastPartialMessageIfExistsWithType: async () => {},
				say: async (_k: string, text?: string) => {
					said.push(String(text))
				},
				shouldAutoApproveTool: () => true,
			},
		}
		const result = await new UseMcpToolHandler().execute(config, {
			name: "use_mcp_tool",
			params: { server_name: "ai-hydro", tool_name: toolName, arguments: JSON.stringify(args) },
			partial: false,
		} as any)
		return { calls, said, result: JSON.stringify(result), mistakes: config.taskState.consecutiveMistakeCount }
	}

	it("a model-issued ensure_project never reaches the server", async () => {
		const r = await run("ensure_project", { root_dir: "/w" })
		expect(r.calls).to.deep.equal([])
		expect(r.result).to.include(hostAudienceRefusal("ensure_project"))
	})

	it("a model-issued set_project_default_study (confirming its own default) never reaches the server", async () => {
		const r = await run("set_project_default_study", { project_id: "prj_x", study_id: "s", confirmed_by: "user" })
		expect(r.calls).to.deep.equal([])
		expect(r.result).to.include("host operation")
		expect(r.mistakes).to.equal(1)
	})
})

describe("the handler reports whether the MCP call failed, from structure (A9)", () => {
	const run = async (callTool: () => Promise<any>) => {
		const taskState: any = { consecutiveMistakeCount: 0, mcpCallFailed: "stale" }
		const config: any = {
			ulid: "01JCHAT",
			cwd: "/w",
			taskState,
			api: { getModel: () => ({ info: { supportsImages: false } }) },
			autoApprovalSettings: { enabled: true, actions: {} },
			services: {
				mcpHub: {
					connections: [
						{
							server: {
								name: "other",
								status: "connected",
								tools: [{ name: "t", autoApprove: true }],
							},
						},
					],
					callTool,
					getPendingNotifications: () => [],
				},
				stateManager: { getGlobalSettingsKey: () => undefined },
			},
			callbacks: {
				removeLastPartialMessageIfExistsWithType: async () => {},
				say: async () => {},
				ask: async () => ({ response: "yesButtonClicked" }),
				shouldAutoApproveTool: () => true,
				saveCheckpoint: async () => {},
			},
			autoApprover: { shouldAutoApproveTool: () => true },
		}
		await new UseMcpToolHandler()
			.execute(config, {
				name: "use_mcp_tool",
				params: { server_name: "other", tool_name: "t", arguments: "{}" },
				partial: false,
			} as any)
			.catch(() => undefined)
		return taskState.mcpCallFailed
	}

	it("isError, a thrown call and a structured error body are failures; an ordinary result is not", async () => {
		expect(await run(async () => ({ isError: true, content: [{ type: "text", text: "boom" }] }))).to.equal(true)
		expect(
			await run(async () => {
				throw new Error("MCP error -32001: Request timed out")
			}),
		).to.equal(true)
		expect(await run(async () => ({ content: [{ type: "text", text: '{"error": true, "code": "X"}' }] }))).to.equal(true)
		expect(
			await run(async () => ({ content: [{ type: "text", text: '{"data": {"q": 1}, "note": "error: true"}' }] })),
		).to.equal(false)
	})
})

describe("hasStructuredError", () => {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const { hasStructuredError } = require("../UseMcpToolHandler")
	it("parses, it does not pattern-match", () => {
		expect(hasStructuredError('{"error": true, "message": "m"}')).to.equal(true)
		expect(hasStructuredError('Error:\n{"error": true}')).to.equal(true)
		expect(hasStructuredError('{"error": "a string"}')).to.equal(false)
		expect(hasStructuredError('{"data": 1}')).to.equal(false)
		expect(hasStructuredError('plain text mentioning {"error": true}')).to.equal(false)
		expect(hasStructuredError("{not json")).to.equal(false)
	})
})
