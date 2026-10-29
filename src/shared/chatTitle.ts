import type { HistoryItem } from "./HistoryItem"

/**
 * Chat titles (PSMH E2, X1-P2): the pure rules, shared by the host and the webview.
 *
 * A title is a short label for a chat. It is never a bare id, never carries a result (a decimal number or a
 * measurement: numbers belong to cited claims, and a history list is a place they would be laundered), and it is
 * never built by parsing a prompt template. Everything here is deterministic and free: the model-written title is
 * checked by `checkTitle` and replaced by `fallbackTitle` when it fails.
 */

export const TITLE_MAX = 60
export const DESCRIPTION_MAX = 140
/** The title of last resort. It always passes `checkTitle`. */
export const UNTITLED = "Untitled chat"

export type TitleRejection = "empty" | "too_long" | "newline" | "markup" | "id" | "decimal" | "measurement"

export type TitleCheck = { ok: true; text: string } | { ok: false; reason: TitleRejection }

/**
 * Text as the checks read it: NFKC (fullwidth forms become ASCII) and every Unicode decimal digit mapped to its ASCII
 * digit, so an id written in Arabic-Indic, Devanagari or fullwidth digits is the same id to the checks. CJK numeral runs
 * are read as digits too, but only for the checks (`cjk: true`, the default): a stored title keeps its own characters.
 */
const CJK_DIGITS = "\u3007\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d"

export function normalizeForChecks(text: string, opts: { cjk?: boolean } = {}): string {
	const cjk = opts.cjk !== false
	const isNd = (cp: number) => cp > 0 && /^\p{Nd}$/u.test(String.fromCodePoint(cp))
	return (
		text
			.normalize("NFKC")
			// Format characters (zero-width space, soft hyphen, ...) are invisible and can split an id.
			.replace(/\p{Cf}/gu, "")
			// The prolonged sound mark is a letter to Unicode but a dash between digits.
			.replace(/(?<=\d)\u30fc(?=\d)/g, "-")
			// CJK numerals only as a run of four or more, so ordinary Chinese text is untouched.
			.replace(/[\u3007\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d]{4,}/g, (run) =>
				cjk ? Array.from(run, (c) => CJK_DIGITS.indexOf(c)).join("") : run,
			)
			.replace(/\p{Nd}/gu, (c) => {
				const cp = c.codePointAt(0)!
				if (cp < 0x80) {
					return c
				}
				// Decimal digits come in runs of ten starting at a zero: count back to the start of this one.
				let back = 0
				while (back < 9 && isNd(cp - back - 1)) {
					back++
				}
				return String(back)
			})
	)
}

/** The text as stored: control and format characters removed, spaces collapsed. No digit is rewritten. */
function tidy(raw: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is being removed
	return raw
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/\p{Cf}/gu, "")
		.replace(/\s+/g, " ")
		.trim()
}

// Ids: a gauge or site id (7 to 15 digits, bare or inside the text), a `basin_` key, a `prj_`/`st_` id, a chat ULID.
const ID_PATTERNS: readonly RegExp[] = [
	/(?:^|[^\d])\d{7,}/,
	// A bare 5 or 6 digit number is a station number in some networks.
	/(?<![\d.,])\d{5,6}(?![\d]|[.,]\d)/,
	/\bbasin_[\dp_]+/i,
	/\b(?:prj|st)_[A-Za-z0-9]{3,}/i,
	/\b[0-9A-HJKMNP-TV-Z]{26}\b/,
]
// A decimal number (1.5, 0,8, .5).
const DECIMAL = /\d[.,]\d|(?:^|[^\d])\.\d/
// A number with a unit, or a skill metric followed by a number.
const MEASUREMENT =
	/\d\s?(?:%|°|(?:mm|cm|km|ft|mi|miles?|ha|cfs|cms|mg|kg|ac|acres?|m3|m³|km2|km²|m|meters?|metres?|feet|inch(?:es)?)(?![A-Za-z]))|\b(?:NSE|KGE|RMSE|PBIAS|BFI|R2|R²)\b\s*[=:≈]?\s*-?\d/i
// Markup: tags, code, emphasis, a markdown link or heading, a table bar, braces.
const MARKUP = /[<>`{}\\|]|\*\*|__|\]\(|^\s*#|^\s*[-*>]\s/

// Seven or more digits across groups split by a short run of non-letters ("0103 1500", "01-03-15-00", "0103_1500", "0103 - 1500").
const SPLIT_DIGITS = /\d(?:[^\p{L}\p{N}]{0,3}\d){6,}/gu

/** A year range or list is not an id: every group is four digits between 1800 and 2100. */
function onlyYears(match: string): boolean {
	const groups = match.split(/[^\p{N}]+/u).filter(Boolean)
	return groups.every((g) => g.length === 4 && Number(g) >= 1800 && Number(g) <= 2100)
}

function hasSplitId(text: string): boolean {
	return (text.match(SPLIT_DIGITS) ?? []).some((m) => !onlyYears(m))
}

/** `text` with split ids taken out (year ranges stay). */
function stripSplitIds(text: string): string {
	return text.replace(SPLIT_DIGITS, (m) => (onlyYears(m) ? m : " "))
}

/** Whole id tokens go first: once punctuation is spaced out, "st_abc99" is two innocent words. */
function stripIdTokens(text: string): string {
	return text.replace(/\b(?:prj|st|basin)_[A-Za-z0-9_]*/gi, " ").replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, " ")
}

/** Brackets a stripped id left empty ("Creek ( ) near") go too. */
function stripEmptyBrackets(text: string): string {
	let out = text
	for (let i = 0; i < 3; i++) {
		out = out.replace(/[([{]\s*[)\]}]/g, " ")
	}
	return out
}

/** Whether `text` names an id anywhere in it. */
export function containsId(text: string): boolean {
	return ID_PATTERNS.some((p) => p.test(text)) || hasSplitId(text)
}

/**
 * The strict check for a title the system produced (a model's reply or the fallback). Returns the text with spaces
 * collapsed, or the reason it was refused. `max` is the length cap (60 for a title, 140 for a description).
 */
export function checkTitle(raw: unknown, max: number = TITLE_MAX): TitleCheck {
	if (typeof raw !== "string") {
		return { ok: false, reason: "empty" }
	}
	if (/[\r\n\u2028\u2029]/.test(raw.trim())) {
		return { ok: false, reason: "newline" }
	}
	const text = tidy(raw)
	const read = normalizeForChecks(text)
	if (!text) {
		return { ok: false, reason: "empty" }
	}
	if (text.length > max) {
		return { ok: false, reason: "too_long" }
	}
	if (MARKUP.test(read)) {
		return { ok: false, reason: "markup" }
	}
	if (containsId(read)) {
		return { ok: false, reason: "id" }
	}
	if (DECIMAL.test(read)) {
		return { ok: false, reason: "decimal" }
	}
	if (MEASUREMENT.test(read)) {
		return { ok: false, reason: "measurement" }
	}
	if (!/\p{L}/u.test(text)) {
		// Numbers and punctuation alone say nothing.
		return { ok: false, reason: "empty" }
	}
	return { ok: true, text }
}

/**
 * The check for a name the user typed. It is the user's own word, so a number or a unit is allowed; what is kept out is
 * what would break the list or hide a chat behind an id: nothing, a line break, markup, or a name that is only an id.
 */
export function checkUserTitle(raw: unknown, max: number = TITLE_MAX): TitleCheck {
	if (typeof raw !== "string") {
		return { ok: false, reason: "empty" }
	}
	if (/[\r\n\u2028\u2029]/.test(raw.trim())) {
		return { ok: false, reason: "newline" }
	}
	const text = tidy(raw)
	const read = normalizeForChecks(text)
	if (!text) {
		return { ok: false, reason: "empty" }
	}
	if (text.length > max) {
		return { ok: false, reason: "too_long" }
	}
	if (MARKUP.test(read)) {
		return { ok: false, reason: "markup" }
	}
	if (containsId(read) && (text.split(" ").length === 1 || /^[^\p{L}]+$/u.test(read))) {
		return { ok: false, reason: "id" }
	}
	return { ok: true, text }
}

// ---- Fallback ------------------------------------------------------------------------------------------------

/** Openers that carry no meaning in a title ("please", "can you", "I want to"). Only the start of the text is trimmed. */
const LEADING_FILLER =
	/^(?:(?:hey|hi|hello|ok|okay|so|well|please|kindly|can you|could you|would you|will you|i want you to|i want to|i would like to|i'd like to|i need to|i need you to|help me|let's|lets|go ahead and)\b[\s,:-]*)+/i

const TRAILING_STOP = new Set([
	"a",
	"an",
	"the",
	"of",
	"for",
	"to",
	"in",
	"on",
	"at",
	"and",
	"or",
	"with",
	"by",
	"from",
	"is",
	"are",
	"near",
])

const FALLBACK_WORDS = 8
const UNIT_WORD = /^(?:mm|cm|km|ft|mi|ha|cfs|cms|mg|kg|ac|acres?|m|m3\/s|m3|km2|miles?|meters?|metres?|feet|inch(?:es)?)$/i

/** Text with code, links, markdown and urls taken out. */
function plainText(text: string): string {
	return stripEmptyBrackets(stripSplitIds(stripIdTokens(normalizeForChecks(text, { cjk: false }))))
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`([^`]*)`/g, "$1")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/https?:\/\/\S+/g, " ")
		.replace(/<[^>]*>/g, " ")
		.replace(/[*_#>|{}\\~]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
}

/**
 * A word that carries a result or an id is dropped. A bare number stays only when it has 3 digits or fewer or is a
 * four-digit year from 1800 to 2100: 4 to 6 digit numbers are station numbers or results in some network.
 */
function keepWord(word: string): boolean {
	const read = normalizeForChecks(word)
	if (!/\d/.test(read)) {
		return true
	}
	if (/^\d+$/.test(read)) {
		return read.length <= 3 || (read.length === 4 && Number(read) >= 1800 && Number(read) <= 2100)
	}
	// Not checkTitle: a year range has no letters and would fail its "says something" rule.
	return !containsId(read) && !DECIMAL.test(read) && !MEASUREMENT.test(read)
}

function capFirst(text: string): string {
	return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

function cutAtWord(text: string, max: number): string {
	let out = text
	if (text.length > max) {
		const cut = text.slice(0, max)
		const space = cut.lastIndexOf(" ")
		out = (space > max / 2 ? cut.slice(0, space) : cut).trim()
	}
	// A cut leaves no dangling "near" or "of".
	const parts = out.split(" ")
	while (parts.length > 1 && TRAILING_STOP.has(parts[parts.length - 1].toLowerCase())) {
		parts.pop()
	}
	return parts.join(" ").replace(/[\s,;:.-]+$/g, "")
}

/** The first meaningful words of `text`: fillers trimmed, ids and results dropped, at most `words` words. */
export function leadingWords(text: string, words: number = FALLBACK_WORDS): string {
	const cleaned = plainText(text).replace(LEADING_FILLER, "")
	const kept: string[] = []
	let afterDropped = false
	for (const raw of cleaned.split(" ")) {
		const w = raw.replace(/^[("'“‘]+|[)"'”’]+$/g, "")
		if (w.length === 0) {
			continue
		}
		if (!keepWord(w)) {
			afterDropped = true
			continue
		}
		// The unit that followed a dropped number ("12.5 mm") goes with it.
		if (afterDropped && UNIT_WORD.test(w)) {
			afterDropped = false
			continue
		}
		afterDropped = false
		kept.push(w)
	}
	kept.splice(words)
	while (kept.length > 1 && TRAILING_STOP.has(kept[kept.length - 1].toLowerCase())) {
		kept.pop()
	}
	return capFirst(kept.join(" ").replace(/[\s,;:.?!-]+$/g, ""))
}

/** A study label without the id the server puts in it: "Piscataquis River near Dover-Foxcroft, ME (USGS 01031500)" becomes the name. */
export function studyNameFromLabel(label: string | undefined): string | undefined {
	if (!label) {
		return undefined
	}
	const named = plainText(label)
		.replace(/\([^)]*\)/g, " ")
		.replace(/\s+/g, " ")
		.trim()
	const kept = named
		.split(" ")
		.filter((w) => w.length > 0 && keepWord(w))
		.join(" ")
		.replace(/[\s,;:.-]+$/g, "")
	return kept && checkTitle(kept).ok ? kept : undefined
}

/** The openers of the map prompts written before `origin` was recorded. Detected, never parsed. */
const MAP_PROMPT_OPENERS = [/^\s*the user clicked the ai-hydro map\b/i]

/** What a title is made from. All of it is already stored on the history item. */
export interface TitleSource {
	origin?: HistoryItem["origin"]
	userQuestion?: string
	task?: string
	/** The bound study's label, if known. It is cleaned before use. */
	studyLabel?: string
}

const GENERIC_BY_ORIGIN: Record<string, string> = {
	map: "Map location question",
	ledger: "Ledger review",
	preview: "Preview chat",
}

/**
 * The deterministic title (PSMH §4.1). A map launch reads its recorded `userQuestion`, never the wrapped prompt; an
 * earlier map prompt (no `origin`) is recognised by its opening line and gets a generic title. Always passes
 * `checkTitle`, at most `TITLE_MAX` characters.
 */
export function fallbackTitle(src: TitleSource): string {
	const mapLegacy = !src.origin && MAP_PROMPT_OPENERS.some((p) => p.test(src.task ?? ""))
	const origin = src.origin ?? (mapLegacy ? "map" : "chat")
	// A map chat is titled by the user's question or by nothing: its task text is the wrapped prompt.
	const text = origin === "map" ? (src.userQuestion ?? "") : (src.userQuestion ?? src.task ?? "")
	const words = leadingWords(text)
	const study = studyNameFromLabel(src.studyLabel)
	let title = ""
	if (study && words) {
		const head = cutAtWord(study, 36)
		title = `${head} · ${cutAtWord(words, TITLE_MAX - head.length - 3)}`
	} else if (study) {
		title = cutAtWord(study, TITLE_MAX)
	} else if (words) {
		title = cutAtWord(words, TITLE_MAX)
	}
	const checked = checkTitle(title)
	if (checked.ok) {
		return checked.text
	}
	return GENERIC_BY_ORIGIN[origin] ?? UNTITLED
}

/**
 * The title to show for a chat: the user's own name, a valid stored title, or the fallback. It never shows the raw
 * first prompt and never a title that fails the check (an item written by something else).
 */
export function displayTitle(
	item: Pick<HistoryItem, "title" | "titleSource" | "origin" | "userQuestion" | "task">,
	studyLabel?: string,
): string {
	if (item.title) {
		const check = item.titleSource === "user" ? checkUserTitle(item.title) : checkTitle(item.title)
		if (check.ok) {
			return check.text
		}
	}
	return fallbackTitle({ origin: item.origin, userQuestion: item.userQuestion, task: item.task, studyLabel })
}

/** An item the user has not named and the generator has not titled: bulk titling would change it, so it is counted. */
export function isBulkTitleCandidate(item: Pick<HistoryItem, "titleSource">): boolean {
	return item.titleSource !== "user" && item.titleSource !== "auto"
}

/** The estimate shown before bulk titling, from the plan's own figure (§4.1: about 1.5k input tokens and at most 80 out per call). */
export const BULK_TITLE_INPUT_TOKENS = 1500
export const BULK_TITLE_OUTPUT_TOKENS = 80

export function estimateBulkTitleTokens(count: number): number {
	return count * (BULK_TITLE_INPUT_TOKENS + BULK_TITLE_OUTPUT_TOKENS)
}
