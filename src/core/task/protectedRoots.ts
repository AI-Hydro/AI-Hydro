import { HostProvider } from "@/hosts/host-provider"
import { computeProtectedRoots } from "./protectedPaths"

/** Protected roots for this process: extension storage from the host, $AIHYDRO_HOME and ~ from the environment. */
export function getHostProtectedRoots(): string[] {
	let globalStoragePath: string | undefined
	try {
		globalStoragePath = HostProvider.get().globalStorageFsPath
	} catch {
		// Host not initialised (unit tests): the environment-derived roots still apply.
	}
	return computeProtectedRoots({ globalStoragePath, aihydroHome: process.env.AIHYDRO_HOME })
}
