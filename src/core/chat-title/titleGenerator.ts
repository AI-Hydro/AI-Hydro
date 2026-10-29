import { checkTitle, DESCRIPTION_MAX, fallbackTitle, studyNameFromLabel, TITLE_MAX, type TitleSource } from "@shared/chatTitle"

/**
 * The model-written title (PSMH §4.1). Everything around the one model call is deterministic: what is sent (bounded,
 * no tool output), what is accepted (`checkTitle`), and what happens when it is not (the fallback). A model is called
 * only when `autoTitle` is on, and the call can be cancelled and times out.
 */

/** About 1,500 tokens of input at four characters a token. The plan's own bound; the real count depends on the provider. */
export const TITLE_INPUT_CHAR_BUDGET = 6000
const FIRST_USER_CHARS = 2500
const ASSISTANT_CHARS = 1800
export const TITLE_CALL_TIMEOUT_MS = 20_000
/** The reply is read up to this many characters and no further; a title and a description fit in far less. */
export const TITLE_REPLY_CHAR_CAP = 600

export interface TitleInput extends TitleSource {
	/** The first assistant reply, truncated. Never a tool result. */
	firstAssistantText?: string
	/** Names of the tools used, no arguments and no outputs. */
	toolNames?: string[]
}

export interface TitleSettings {
	autoTitle: boolean
}

/** Calls the title model with a system and a user message and returns its text. Rejects on error; honours `signal`. */
export type TitleModelCall = (system: string, user: string, signal: AbortSignal) => Promise<string>

export interface TitleResult {
	title: string
	description?: string
	/** "auto": a model wrote it. "fallback": the deterministic title. */
	source: "auto" | "fallback"
	/** A model was called (whether or not its reply was used). */
	modelCalled: boolean
	/** The call was cancelled: the caller writes nothing. */
	cancelled?: boolean
}

const SYSTEM_PROMPT = [
	'You name research chats. Reply with one JSON object and nothing else: {"title": string, "description": string}.',
	`title: at most ${TITLE_MAX} characters, plain words, no quotes, no markdown. Say what the chat is about.`,
	`description: one sentence, at most ${DESCRIPTION_MAX} characters.`,
	"Never write an identifier (a gauge, site or basin id, or anything like prj_ or st_), a number with a decimal point, a measurement or a unit, or a result value.",
	"Name the place or the question in words instead.",
].join("\n")

/** The request for one title. No tool output ever goes in; each part has its own cap and the whole stays inside the budget. */
export function buildTitleRequest(input: TitleInput): { system: string; user: string } {
	const origin = input.origin ?? "chat"
	// A map launch is described by what the user asked, never by the wrapped prompt.
	const asked = origin === "map" ? (input.userQuestion ?? "") : (input.userQuestion ?? input.task ?? "")
	const parts: string[] = []
	const question = clean(asked, FIRST_USER_CHARS)
	if (question) {
		parts.push(`The user's first message:\n${question}`)
	} else if (origin === "map") {
		parts.push("The chat was started from a map click; the user has asked nothing yet.")
	}
	const study = studyNameFromLabel(input.studyLabel)
	if (study) {
		parts.push(`Study: ${study}`)
	}
	const reply = clean(input.firstAssistantText ?? "", ASSISTANT_CHARS)
	if (reply) {
		parts.push(`The assistant's first reply (truncated):\n${reply}`)
	}
	const tools = [...new Set((input.toolNames ?? []).filter((t) => /^[\w.:-]{1,60}$/.test(t)))].slice(0, 8)
	if (tools.length > 0) {
		parts.push(`Tools used: ${tools.join(", ")}`)
	}
	return { system: SYSTEM_PROMPT, user: parts.join("\n\n").slice(0, TITLE_INPUT_CHAR_BUDGET) }
}

function clean(text: string, max: number): string {
	return text
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, max)
}

/** `{title, description}` from a model reply (a fenced or surrounded JSON object is tolerated), or undefined. */
export function parseTitleReply(reply: string): { title: string; description?: string } | undefined {
	const start = reply.indexOf("{")
	const end = reply.lastIndexOf("}")
	if (start < 0 || end <= start) {
		return undefined
	}
	let parsed: unknown
	try {
		parsed = JSON.parse(reply.slice(start, end + 1))
	} catch {
		return undefined
	}
	if (!parsed || typeof parsed !== "object") {
		return undefined
	}
	const { title, description } = parsed as { title?: unknown; description?: unknown }
	if (typeof title !== "string") {
		return undefined
	}
	return { title, ...(typeof description === "string" ? { description } : {}) }
}

/** Link the caller's signal to a timeout; the returned `done()` clears the timer. */
function withTimeout(
	parent: AbortSignal | undefined,
	ms: number,
): { signal: AbortSignal; timedOut: () => boolean; done: () => void } {
	const controller = new AbortController()
	let timedOut = false
	const onParent = () => controller.abort()
	if (parent?.aborted) {
		controller.abort()
	}
	parent?.addEventListener("abort", onParent, { once: true })
	const timer = setTimeout(() => {
		timedOut = true
		controller.abort()
	}, ms)
	timer.unref?.()
	return {
		signal: controller.signal,
		timedOut: () => timedOut,
		done: () => {
			clearTimeout(timer)
			parent?.removeEventListener("abort", onParent)
		},
	}
}

/**
 * Title a chat. With `autoTitle` off no model is called. A failed call, a timeout or a reply that does not pass
 * `checkTitle` gives the fallback; a cancelled call gives `cancelled` and the caller writes nothing.
 */
export async function generateTitle(args: {
	input: TitleInput
	settings: TitleSettings
	call: TitleModelCall
	signal?: AbortSignal
	timeoutMs?: number
}): Promise<TitleResult> {
	const fallback: TitleResult = { title: fallbackTitle(args.input), source: "fallback", modelCalled: false }
	if (!args.settings.autoTitle) {
		return fallback
	}
	if (args.signal?.aborted) {
		return { ...fallback, cancelled: true }
	}
	const request = buildTitleRequest(args.input)
	if (!request.user) {
		// Nothing to go on yet: a model call would only guess.
		return fallback
	}
	const guard = withTimeout(args.signal, args.timeoutMs ?? TITLE_CALL_TIMEOUT_MS)
	try {
		const reply = await args.call(request.system, request.user, guard.signal)
		if (args.signal?.aborted) {
			return { ...fallback, modelCalled: true, cancelled: true }
		}
		const parsed = parseTitleReply(reply)
		const title = parsed ? checkTitle(parsed.title) : undefined
		if (!parsed || !title?.ok) {
			return { ...fallback, modelCalled: true }
		}
		const description = parsed.description === undefined ? undefined : checkTitle(parsed.description, DESCRIPTION_MAX)
		return {
			title: title.text,
			...(description?.ok ? { description: description.text } : {}),
			source: "auto",
			modelCalled: true,
		}
	} catch {
		if (args.signal?.aborted) {
			return { ...fallback, modelCalled: true, cancelled: true }
		}
		// An error or a timeout: the deterministic title stands.
		return { ...fallback, modelCalled: true }
	} finally {
		guard.done()
	}
}
