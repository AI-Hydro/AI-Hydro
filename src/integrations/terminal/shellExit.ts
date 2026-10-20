import type { CommandExit } from "@shared/aihydro/commandEvidence"

/**
 * Exit code of the command a shell-integration stream chunk describes, from VS Code's `OSC 633 ; D [; <exitcode>]`
 * "execution finished" mark. Only a D that follows the chunk's last `633;C` (pre-execution) counts, so the previous
 * prompt's D at the head of a first chunk is never mistaken for this command's. Returns undefined when the chunk
 * carries no D, and "unknown" when it carries a D with no code (the shell did not report one).
 */
export function parseExitFromChunk(chunk: string): CommandExit | undefined {
	const lastStart = chunk.lastIndexOf("633;C")
	const tail = lastStart === -1 ? chunk : chunk.slice(lastStart)
	let found: CommandExit | undefined
	for (const m of tail.matchAll(/633;D(?:;(-?\d+))?/g)) {
		found = m[1] === undefined ? "unknown" : Number(m[1])
	}
	return found
}
