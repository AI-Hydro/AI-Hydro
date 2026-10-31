import type { SubagentOrigin } from "@shared/aihydro/subagents"
import type { AiHydroAsk } from "@shared/ExtensionMessage"
import type { AiHydroAskResponse } from "@shared/WebviewMessage"
import type { AskMeta } from "../askMeta"

export interface AskResult {
	response: AiHydroAskResponse
	text?: string
	images?: string[]
	files?: string[]
}

/** The parent's own `Task.ask` (with host-supplied meta). The bridge never calls anything else on the parent. */
export type ParentAsk = (type: AiHydroAsk, text?: string, partial?: boolean, meta?: AskMeta) => Promise<AskResult>

/**
 * Ask types a child may raise: a built-in read ("tool") and an MCP call or resource read ("use_mcp_server"). The
 * profile admits nothing else, and this is the second line: a child can never put a command, a completion, a free-text
 * question or a new task in front of the user.
 */
const CHILD_ASK_TYPES: ReadonlySet<AiHydroAsk> = new Set<AiHydroAsk>(["tool", "use_mcp_server"])

export class ChildAskRefused extends Error {}

/**
 * The only path from a child to the user (plan S5). Every child approval becomes the PARENT's ask, so the chat shows
 * it, `ask_ts` binding applies to it unchanged, and the pending badge and live region work as for any other ask.
 *
 * - One pending child ask at a time, FIFO. `Task.ask` supersedes the pending ask whenever `lastMessageTs` moves, so
 *   two asks alive at once would cancel each other; the queue makes that impossible.
 * - Partial asks are dropped. A child's blocks run only when complete, so a partial ask is always a bug.
 * - The origin is stamped here, from the runner's own identity. Nothing a model wrote can set it.
 * - A child's `say` never reaches the parent: it would move `lastMessageTs` and supersede the pending ask.
 */
export class ParentAskBridge {
	private tail: Promise<unknown> = Promise.resolve()
	private pending = 0
	private lastTailError: unknown

	constructor(
		private readonly parentAsk: ParentAsk,
		private readonly isAborted: () => boolean,
	) {}

	/** Asks queued or pending right now (for the live region and tests). */
	get depth(): number {
		return this.pending
	}

	ask(origin: SubagentOrigin, type: AiHydroAsk, text: string | undefined, partial?: boolean): Promise<AskResult> {
		if (!CHILD_ASK_TYPES.has(type)) {
			return Promise.reject(new ChildAskRefused(`A subagent may not raise a '${type}' ask.`))
		}
		if (partial === true) {
			return Promise.reject(new ChildAskRefused("A subagent's partial ask was dropped."))
		}
		this.pending++
		const run = async (): Promise<AskResult> => {
			try {
				if (this.isAborted()) {
					throw new Error("AI-Hydro instance aborted")
				}
				// partial is deliberately not forwarded: the parent sees a complete, ordinary ask with an origin.
				return await this.parentAsk(type, text, undefined, { subagentOrigin: origin })
			} finally {
				this.pending--
			}
		}
		// Chain after the previous ask whether it resolved or not, so one failed ask never wedges the queue.
		const result = this.tail.then(run, run)
		this.tail = result.catch((error) => {
			this.lastTailError = error
		})
		return result
	}
}
