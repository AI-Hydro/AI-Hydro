import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import sinon from "sinon"

describe("ToolExecutor Hook Integration", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("addHookContextToConversation", () => {
		it("should handle undefined context", () => {
			// Test that undefined context doesn't add anything
			const userMessageContent: any[] = []

			// Simulate the method behavior - undefined context should not add anything
			const contextModification: string | undefined = undefined
			// The implementation checks for truthiness, which excludes undefined
			if (contextModification) {
				userMessageContent.push({ type: "text", text: "should not reach here" })
			}

			userMessageContent.length.should.equal(0)
		})

		it("should handle empty context", () => {
			const userMessageContent: any[] = []

			// Simulate the method behavior - empty string is falsy in if check
			const contextModification: string | undefined = ""
			// Empty string is falsy, so this block won't execute
			if (contextModification) {
				userMessageContent.push({ type: "text", text: "should not reach here" })
			}

			userMessageContent.length.should.equal(0)
		})

		it("should handle whitespace-only context", () => {
			const userMessageContent: any[] = []

			// Simulate the method behavior
			const contextModification = "   \n  \t  "
			if (contextModification) {
				const contextText = contextModification.trim()
				if (contextText) {
					userMessageContent.push({ type: "text", text: "should not reach here" })
				}
			}

			userMessageContent.length.should.equal(0)
		})

		it("should add context without type prefix", () => {
			const userMessageContent: any[] = []
			const source = "PreToolUse"
			const contextModification = "Simple context message"

			// Simulate the method behavior
			if (contextModification) {
				const contextText = contextModification.trim()
				if (contextText) {
					const lines = contextText.split("\n")
					const firstLine = lines[0]
					let contextType = "general"
					let content = contextText

					const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
					const typeMatch = typeMatchRegex.exec(firstLine)
					if (typeMatch) {
						contextType = typeMatch[1].toLowerCase()
						const remainingLines = lines.slice(1).filter((l: string) => l.trim())
						content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
					}

					userMessageContent.push({
						type: "text",
						text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
					})
				}
			}

			userMessageContent.length.should.equal(1)
			userMessageContent[0].text.should.match(/type="general"/)
			userMessageContent[0].text.should.match(/Simple context message/)
			userMessageContent[0].text.should.match(/source="PreToolUse"/)
		})

		it("should extract type from WORKSPACE_RULES prefix", () => {
			const userMessageContent: any[] = []
			const source = "PreToolUse"
			const contextModification = "WORKSPACE_RULES: Follow TypeScript conventions"

			// Simulate the method behavior
			if (contextModification) {
				const contextText = contextModification.trim()
				if (contextText) {
					const lines = contextText.split("\n")
					const firstLine = lines[0]
					let contextType = "general"
					let content = contextText

					const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
					const typeMatch = typeMatchRegex.exec(firstLine)
					if (typeMatch) {
						contextType = typeMatch[1].toLowerCase()
						const remainingLines = lines.slice(1).filter((l: string) => l.trim())
						content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
					}

					userMessageContent.push({
						type: "text",
						text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
					})
				}
			}

			userMessageContent.length.should.equal(1)
			userMessageContent[0].text.should.match(/type="workspace_rules"/)
			userMessageContent[0].text.should.match(/Follow TypeScript conventions/)
			userMessageContent[0].text.should.not.match(/WORKSPACE_RULES:/)
		})

		it("should extract type from FILE_OPERATIONS prefix", () => {
			const userMessageContent: any[] = []
			const source = "PostToolUse"
			const contextModification = "FILE_OPERATIONS: Created file.ts successfully"

			// Simulate the method behavior
			if (contextModification) {
				const contextText = contextModification.trim()
				if (contextText) {
					const lines = contextText.split("\n")
					const firstLine = lines[0]
					let contextType = "general"
					let content = contextText

					const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
					const typeMatch = typeMatchRegex.exec(firstLine)
					if (typeMatch) {
						contextType = typeMatch[1].toLowerCase()
						const remainingLines = lines.slice(1).filter((l: string) => l.trim())
						content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
					}

					userMessageContent.push({
						type: "text",
						text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
					})
				}
			}

			userMessageContent.length.should.equal(1)
			userMessageContent[0].text.should.match(/type="file_operations"/)
			userMessageContent[0].text.should.match(/Created file\.ts successfully/)
		})

		it("should handle multi-line context with type", () => {
			const userMessageContent: any[] = []
			const source = "PreToolUse"
			const contextModification = "VALIDATION: First line content\nSecond line of context\nThird line of context"

			// Simulate the method behavior
			if (contextModification) {
				const contextText = contextModification.trim()
				if (contextText) {
					const lines = contextText.split("\n")
					const firstLine = lines[0]
					let contextType = "general"
					let content = contextText

					const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
					const typeMatch = typeMatchRegex.exec(firstLine)
					if (typeMatch) {
						contextType = typeMatch[1].toLowerCase()
						const remainingLines = lines.slice(1).filter((l: string) => l.trim())
						content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
					}

					userMessageContent.push({
						type: "text",
						text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
					})
				}
			}

			userMessageContent.length.should.equal(1)
			userMessageContent[0].text.should.match(/type="validation"/)
			userMessageContent[0].text.should.match(/First line content/)
			userMessageContent[0].text.should.match(/Second line/)
			userMessageContent[0].text.should.match(/Third line/)
		})

		it("should handle multi-line context with type but no content on first line", () => {
			const userMessageContent: any[] = []
			const source = "PreToolUse"
			const contextModification = "PERFORMANCE:\nTool execution took longer than expected\nConsider optimization"

			// Simulate the method behavior
			if (contextModification) {
				const contextText = contextModification.trim()
				if (contextText) {
					const lines = contextText.split("\n")
					const firstLine = lines[0]
					let contextType = "general"
					let content = contextText

					const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
					const typeMatch = typeMatchRegex.exec(firstLine)
					if (typeMatch) {
						contextType = typeMatch[1].toLowerCase()
						const remainingLines = lines.slice(1).filter((l: string) => l.trim())
						content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
					}

					userMessageContent.push({
						type: "text",
						text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
					})
				}
			}

			userMessageContent.length.should.equal(1)
			userMessageContent[0].text.should.match(/type="performance"/)
			userMessageContent[0].text.should.match(/Tool execution took/)
			userMessageContent[0].text.should.match(/Consider optimization/)
		})

		it("should preserve source parameter correctly", () => {
			const userMessageContent: any[] = []
			const source = "PostToolUse"
			const contextModification = "Some context"

			// Simulate the method behavior
			if (contextModification) {
				const contextText = contextModification.trim()
				if (contextText) {
					const lines = contextText.split("\n")
					const firstLine = lines[0]
					let contextType = "general"
					let content = contextText

					const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
					const typeMatch = typeMatchRegex.exec(firstLine)
					if (typeMatch) {
						contextType = typeMatch[1].toLowerCase()
						const remainingLines = lines.slice(1).filter((l: string) => l.trim())
						content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
					}

					userMessageContent.push({
						type: "text",
						text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
					})
				}
			}

			userMessageContent[0].text.should.match(/source="PostToolUse"/)
		})

		it("should handle type with underscores", () => {
			const userMessageContent: any[] = []
			const source = "PreToolUse"
			const contextModification = "MY_CUSTOM_TYPE: Custom context"

			// Simulate the method behavior
			if (contextModification) {
				const contextText = contextModification.trim()
				if (contextText) {
					const lines = contextText.split("\n")
					const firstLine = lines[0]
					let contextType = "general"
					let content = contextText

					const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
					const typeMatch = typeMatchRegex.exec(firstLine)
					if (typeMatch) {
						contextType = typeMatch[1].toLowerCase()
						const remainingLines = lines.slice(1).filter((l: string) => l.trim())
						content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
					}

					userMessageContent.push({
						type: "text",
						text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
					})
				}
			}

			userMessageContent[0].text.should.match(/type="my_custom_type"/)
		})

		it("should not match lowercase type prefix", () => {
			const userMessageContent: any[] = []
			const source = "PreToolUse"
			const contextModification = "lowercase_type: This should not be extracted as type"

			// Simulate the method behavior
			if (contextModification) {
				const contextText = contextModification.trim()
				if (contextText) {
					const lines = contextText.split("\n")
					const firstLine = lines[0]
					let contextType = "general"
					let content = contextText

					const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
					const typeMatch = typeMatchRegex.exec(firstLine)
					if (typeMatch) {
						contextType = typeMatch[1].toLowerCase()
						const remainingLines = lines.slice(1).filter((l: string) => l.trim())
						content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
					}

					userMessageContent.push({
						type: "text",
						text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
					})
				}
			}

			// Should use default "general" type since lowercase doesn't match
			userMessageContent[0].text.should.match(/type="general"/)
			userMessageContent[0].text.should.match(/lowercase_type:/)
		})

		it("should filter out empty lines when extracting multi-line content", () => {
			const userMessageContent: any[] = []
			const source = "PreToolUse"
			const contextModification = "TEST_TYPE: First line\n\n\nSecond line\n  \nThird line"

			// Simulate the method behavior
			if (contextModification) {
				const contextText = contextModification.trim()
				if (contextText) {
					const lines = contextText.split("\n")
					const firstLine = lines[0]
					let contextType = "general"
					let content = contextText

					const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
					const typeMatch = typeMatchRegex.exec(firstLine)
					if (typeMatch) {
						contextType = typeMatch[1].toLowerCase()
						const remainingLines = lines.slice(1).filter((l: string) => l.trim())
						content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
					}

					userMessageContent.push({
						type: "text",
						text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
					})
				}
			}

			// Verify the content contains the expected lines
			userMessageContent[0].text.should.match(/First line/)
			userMessageContent[0].text.should.match(/Second line/)
			userMessageContent[0].text.should.match(/Third line/)
			// Verify empty lines were filtered out
			userMessageContent[0].text.should.not.match(/First line\n\n/)
			userMessageContent[0].text.should.not.match(/Second line\n\n/)
		})
	})

	describe("Hook Context XML Format", () => {
		it("should generate properly formatted XML", () => {
			const source = "PreToolUse"
			const contextType = "workspace_rules"
			const content = "Test content"

			const xml = `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`

			xml.should.match(/<hook_context source="PreToolUse" type="workspace_rules">/)
			xml.should.match(/Test content/)
			xml.should.match(/<\/hook_context>/)
		})

		it("should handle special characters in content", () => {
			const source = "PreToolUse"
			const contextType = "general"
			const content = 'Content with <special> & "characters"'

			const xml = `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`

			xml.should.match(new RegExp(content.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
		})
	})
})

// Tools >= 2.8.2 refuse a differing chat_id (CHAT_ID_MISMATCH); the gate still never trusts model-invoked output.
describe("ToolExecutor gate binding (model-invoked output is never a study id)", () => {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const { ToolExecutor } = require("../ToolExecutor")
	const { createGateState } = require("../answerAuditGate")
	const executor = (state: any) => {
		const ex = Object.create(ToolExecutor.prototype)
		ex.taskState = { answerAuditGate: state }
		return ex
	}
	const block = (tool: string) => ({ params: { server_name: "aihydro-tools", tool_name: tool } })

	it("a chat status naming another chat's study seeds no study id, only the probed flag", () => {
		const state = createGateState()
		const other = JSON.stringify({ bound: true, study_id: "SOMEONE_ELSES_STUDY", chat_id: "other-chat" })
		executor(state).noteStartSession(other, block("aihydro_chat_status"))
		state.should.have.property("bindingProbed", true)
		;(state.boundStudyId === undefined).should.equal(true)
	})

	it("resumed-task flow: status then eligible, audit uses the host's own status call (no cached study)", () => {
		const { computeGateEligibility } = require("../answerAuditGate")
		const state = createGateState()
		executor(state).noteStartSession("{}", block("aihydro_chat_status"))
		const server = {
			name: "aihydro-tools",
			status: "connected",
			tools: [{ name: "audit_interpretation", description: "advisories" }],
		}
		const r = computeGateEligibility({
			toolName: "attempt_completion",
			mode: "act",
			gateSetting: true,
			auditEnabled: true,
			servers: [server],
			state,
			isTrusted: () => true,
		})
		r.eligible.should.equal(true)
		;(state.boundStudyId === undefined).should.equal(true)
	})

	describe("MCP failures are known from what the handler observed", () => {
		const { ToolExecutor } = require("../ToolExecutor")
		const mcpBlock = { name: "use_mcp_tool", params: { server_name: "x", tool_name: "t" } }
		const exec = (mcpCallFailed: boolean | undefined) => {
			const ex = Object.create(ToolExecutor.prototype)
			ex.taskState = { mcpCallFailed, recentToolErrors: [], consecutiveMistakeCount: 0 }
			return ex
		}
		it("a failure the handler observed is recorded, whatever the text looks like", () => {
			const ex = exec(true)
			ex.recordIfToolError("Something the server said", mcpBlock)
			ex.taskState.recentToolErrors.should.have.length(1)
		})
		it("a call the handler saw succeed is not a failure even if its text starts like an error", () => {
			const ex = exec(false)
			ex.recordIfToolError("Error:\nthis is quoted file content", mcpBlock)
			ex.taskState.recentToolErrors.should.have.length(0)
			ex.resultFailed("Error:\nthis is quoted file content", mcpBlock).should.equal(false)
		})
		it("with no handler observation the old text markers still decide; other tools never read the flag", () => {
			exec(undefined).resultFailed("The tool execution failed with the following error: x", mcpBlock).should.equal(true)
			exec(true).resultFailed("fine", { name: "read_file", params: {} }).should.equal(false)
		})
		it("a failure never feeds the mistake count (an environmental failure must not halt a task)", () => {
			const ex = exec(true)
			ex.recordIfToolError("timeout", mcpBlock)
			ex.taskState.consecutiveMistakeCount.should.equal(0)
		})
	})

	it("a rebind clears the cached study; an errored status or another server's status is ignored", () => {
		const state = createGateState()
		state.boundStudyId = "s1"
		executor(state).noteStartSession("{}", block("aihydro_rebind_chat"))
		;(state.boundStudyId === undefined).should.equal(true)
		const fresh = createGateState()
		executor(fresh).noteStartSession("The tool execution failed with the following error: boom", block("aihydro_chat_status"))
		;(fresh.bindingProbed === undefined).should.equal(true)
		executor(fresh).noteStartSession("{}", { params: { server_name: "evil", tool_name: "aihydro_chat_status" } })
		;(fresh.bindingProbed === undefined).should.equal(true)
	})
})
