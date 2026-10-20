import type { CommandExit } from "@shared/aihydro/commandEvidence"

/**
 * Exit code of a command from VS Code's shell-integration marks `ESC ] 633 ; D [; <exitcode>]` (terminated by BEL or
 * ST). Output text that merely contains "633;D;0" is not a mark: only a complete escape sequence counts, so a command
 * cannot print its way to exit 0. A sequence split across stream chunks is buffered until its terminator arrives.
 * Only a D after the latest `633;C` (pre-execution) counts, so the previous prompt's D is never this command's.
 */
const MARK = /\x1b\]633;([A-Z])(?:;([^\x07\x1b]*))?(?:\x07|\x1b\\)/g
const MAX_PENDING = 256

export class ExitMarkScanner {
	private pending = ""
	/** undefined = no terminated D mark seen for this command; "unknown" = a D without a code. */
	exit: CommandExit | undefined

	push(chunk: string): CommandExit | undefined {
		const text = this.pending + chunk
		let consumed = 0
		for (const m of text.matchAll(MARK)) {
			consumed = (m.index ?? 0) + m[0].length
			if (m[1] === "C") {
				this.exit = undefined
			} else if (m[1] === "D") {
				const code = m[2]?.split(";")[0]
				this.exit = code !== undefined && /^-?\d+$/.test(code) ? Number(code) : "unknown"
			}
		}
		// Keep an unterminated trailing sequence for the next chunk.
		const rest = text.slice(consumed)
		const start = rest.lastIndexOf("\x1b]")
		this.pending = start === -1 ? (rest.endsWith("\x1b") ? "\x1b" : "") : rest.slice(start).slice(-MAX_PENDING)
		return this.exit
	}
}

/** One-shot form for a single complete chunk. */
export function parseExitFromChunk(chunk: string): CommandExit | undefined {
	return new ExitMarkScanner().push(chunk)
}
