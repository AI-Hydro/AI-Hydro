import { ModelFamily } from "@/shared/prompts"
import { AiHydroDefaultTool } from "@/shared/tools"
import type { AiHydroToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const nextGen: AiHydroToolSpec = {
	variant: ModelFamily.NEXT_GEN,
	id: AiHydroDefaultTool.WEB_FETCH,
	name: "web_fetch",
	description: `Fetches content from a specified URL and processes into markdown
- Takes a URL as input
- Fetches the URL content, converts HTML to markdown
- Use this tool when you need to retrieve and analyze web content
- IMPORTANT: If an MCP-provided web fetch tool is available, prefer using that tool instead of this one, as it may have fewer restrictions.
- The URL must be a fully-formed valid URL
- HTTP URLs will be automatically upgraded to HTTPS
- This tool is read-only and does not modify any files`,
	parameters: [
		{
			name: "url",
			required: true,
			instruction: "The URL to fetch content from",
			usage: "https://example.com/docs",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const gpt = { ...nextGen, variant: ModelFamily.GPT }

export const web_fetch_variants = [nextGen, gpt]
