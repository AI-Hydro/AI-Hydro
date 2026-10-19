import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js"

/**
 * Environment for an MCP stdio server the extension launches. Every such server runs in an AGENT context
 * (approval redesign AP1, B4): AIHYDRO_AGENT_CONTEXT=1 is set last, so a settings `env` entry cannot clear it, and
 * `run_python` children of the first-party server inherit it. The approval CLI refuses to approve a claim in
 * any process that carries the marker.
 */
export function buildStdioServerEnv(configEnv: Record<string, string> | undefined): Record<string, string> {
	return {
		...getDefaultEnvironment(),
		...(configEnv || {}),
		AIHYDRO_AGENT_CONTEXT: "1",
	}
}
