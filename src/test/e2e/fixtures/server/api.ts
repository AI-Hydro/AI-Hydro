export const E2E_REGISTERED_MOCK_ENDPOINTS = {
	"/api/v1": {
		GET: [
			"/generation",
			"/organizations/{orgId}/balance",
			"/organizations/{orgId}/members/{memberId}/usages",
			"/users/me",
			"/users/{userId}/balance",
			"/users/{userId}/usages",
			"/users/{userId}/payments",
		],
		POST: ["/chat/completions", "/auth/token"],
		PUT: ["/users/active-account"],
	},
	"/.test": {
		GET: [],
		POST: ["/auth", "/setUserBalance", "/setUserHasOrganization", "/setOrgBalance"],
		PUT: [],
	},
	"/health": {
		POST: [],
		GET: ["/", "/ping"],
		PUT: [],
	},
}

const replace_in_file = `I successfully replaced "john" with "cline" in the test.ts file. The change has been completed and the file now contains:

\`\`\`typescript
export const name = "cline"
\`\`\`

The TypeScript errors shown in the output are unrelated to this change - they appear to be existing issues in the broader codebase related to missing type definitions and dependencies. The specific task of updating the name in test.ts has been completed successfully.

<attempt_completion>
<result>
I have successfully replaced the name "john" with "cline" in the test.ts file. The file now exports:

\`\`\`typescript
export const name = "cline"
\`\`\`

The change has been applied and saved to the file.
</result>
</attempt_completion>`

const edit_request = `<thinking>
The user wants me to replace the name "john" with "cline" in the test.ts file. I can see the file content provided:

\`\`\`typescript
export const name = "john"
\`\`\`

I need to change "john" to "cline". This is a simple targeted edit, so I should use the replace_in_file tool rather than write_to_file since I\'m only changing one small part of the file.

I need to:
1. Use replace_in_file to change "john" to "cline" in the test.ts file
2. The SEARCH block should match the exact content: \`export const name = "john"\`
3. The REPLACE block should be: \`export const name = "cline"\`
</thinking>

I\'ll replace "john" with "cline" in the test.ts file.

<replace_in_file>
<path>test.ts</path>
<diff>
------- SEARCH
export const name = "john"
=======
export const name = "cline"
+++++++ REPLACE
</diff>
</replace_in_file>`

// W2-A2: one user turn that reads three workspace files and then answers. The server picks the next step from the tool
// results already in the request body, so the sequence is deterministic across the four provider requests.
// No prose before the call: a non-empty text row breaks a work group, and this fixture is about one group of three.
const read_file_step = (path: string) => `<read_file>
<path>${path}</path>
</read_file>`

const read_three_done = `<attempt_completion>
<result>
I read test.ts, README.md and index.html. This is a mock answer, not a result.
</result>
</attempt_completion>`

export const E2E_READ_THREE_FILES = [
	{ after: "[read_file for 'index.html'] Result:", text: read_three_done },
	{ after: "[read_file for 'README.md'] Result:", text: read_file_step("index.html") },
	{ after: "[read_file for 'test.ts'] Result:", text: read_file_step("README.md") },
	{ after: "read_three_files", text: read_file_step("test.ts") },
]

export const E2E_MOCK_API_RESPONSES = {
	DEFAULT: "Hello! I'm a mock AI-Hydro API response.",
	REPLACE_REQUEST: replace_in_file,
	EDIT_REQUEST: edit_request,
}
