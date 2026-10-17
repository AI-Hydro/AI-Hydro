import { HostProvider } from "@/hosts/host-provider"

/**
 * Workspace root sent to ai-hydro MCP tools: the first workspace folder visible through the
 * HostProvider abstraction (the VS Code Explorer root), falling back to the task cwd.
 */
export async function resolveWorkspaceRoot(cwd: string | undefined): Promise<string | undefined> {
	try {
		const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
		if (workspacePaths.paths && workspacePaths.paths.length > 0) {
			return workspacePaths.paths[0]
		}
	} catch {
		// HostProvider unavailable (test env, non-VS Code host) — keep cwd
	}
	return cwd
}
