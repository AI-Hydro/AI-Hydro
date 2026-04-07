import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

/**
 * Parameters used to detect CLI subagent context
 */
interface CliSubagentDetectionParams {
	yoloModeToggled: boolean
	maxConsecutiveMistakes: number
	isOneshot?: boolean
	outputFormat?: string
}

/**
 * Check if the AI-Hydro CLI tool is installed on the system
 * @returns true if CLI is installed, false otherwise
 */
export async function isAiHydroCliInstalled(): Promise<boolean> {
	try {
		// Try to get the version of the aihydro CLI tool
		// This will fail if the tool is not installed
		const { stdout } = await execAsync("aihydro version", {
			timeout: 5000, // 5 second timeout
		})

		// If we get here, the CLI is installed
		// We could also validate the version if needed
		return stdout.includes("AI-Hydro CLI Version") || stdout.includes("AI-Hydro Core Version")
	} catch (error) {
		// Command failed, which likely means CLI is not installed
		// or not in PATH
		return false
	}
}

/**
 * Detect if the current AI-Hydro instance is running as a CLI subagent.
 * CLI subagents are identified by specific parameter patterns set by the transformAiHydroCommand function.
 *     TODO - For now we are relying on the maxConsecutiveMistakes value, which will only ever be "3"
 *     unless users pass in "-s max_consecutive_mistakes=6" via AI-Hydro CLI. Would like better detection.
 * @param params The current task parameters to analyze
 * @returns true if this appears to be a CLI subagent context
 */
export function isCliSubagentContext(params: CliSubagentDetectionParams): boolean {
	const hasYoloMode = params.yoloModeToggled === true
	const hasHighMistakeLimit = params.maxConsecutiveMistakes === 6

	return hasYoloMode && hasHighMistakeLimit
}
