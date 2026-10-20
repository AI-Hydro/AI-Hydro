/**
 * The one place the extension resolves the AI-Hydro state directory.
 *
 * Mirrors the server resolver (`ai_hydro.registry.paths.aihydro_home`):
 * `$AIHYDRO_HOME` when set (a leading `~` expands to the user's home),
 * otherwise `~/.aihydro`. Resolved at call time, so a test or a scratch
 * profile can redirect it without reloading modules. Every other file under
 * `src/` must call this rather than join `os.homedir()` with `.aihydro`.
 */
import * as os from "os"
import * as path from "path"

export const AIHYDRO_HOME_ENV = "AIHYDRO_HOME"

export function aihydroHome(env: NodeJS.ProcessEnv = process.env, homeDir: string = os.homedir()): string {
	const override = env[AIHYDRO_HOME_ENV]
	if (override) {
		if (override === "~") {
			return homeDir
		}
		if (override.startsWith("~/") || override.startsWith("~\\")) {
			return path.join(homeDir, override.slice(2))
		}
		return override
	}
	return path.join(homeDir, ".aihydro")
}

/** Join path segments under the AI-Hydro home. */
export function aihydroPath(...segments: string[]): string {
	return path.join(aihydroHome(), ...segments)
}
