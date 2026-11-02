import { HostProvider } from "@/hosts/host-provider"
import { computeProtectedRoots } from "./protectedPaths"

let resolvedAgentsDir: string | undefined

/** Record where the user's global agents folder is, once the host has resolved it (the Rules folder's sibling). */
export function noteAgentsDirectory(dir: string | undefined): void {
	resolvedAgentsDir = dir
}

/** Protected roots for this process: extension storage from the host, $AIHYDRO_HOME and ~ from the environment. */
export function getHostProtectedRoots(): string[] {
	let globalStoragePath: string | undefined
	try {
		globalStoragePath = HostProvider.get().globalStorageFsPath
	} catch {
		// Host not initialised (unit tests): the environment-derived roots still apply.
	}
	return computeProtectedRoots({
		globalStoragePath,
		aihydroHome: process.env.AIHYDRO_HOME,
		learningPackRoot: process.env.AIHYDRO_LEARNING_PACK_ROOT,
		agentsDir: resolvedAgentsDir,
	})
}
