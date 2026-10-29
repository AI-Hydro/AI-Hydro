import { expect } from "chai"
import { describe, it } from "mocha"
import {
	checkTitle,
	checkUserTitle,
	DESCRIPTION_MAX,
	displayTitle,
	estimateBulkTitleTokens,
	fallbackTitle,
	isBulkTitleCandidate,
	studyNameFromLabel,
	TITLE_MAX,
	UNTITLED,
} from "../chatTitle"

/** Independent of the code under test: fold the two digit sets the tests use to ASCII. */
const fold = (s: string) =>
	s
		.replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x660))
		.replace(/[\uff10-\uff19]/g, (c) => String(c.charCodeAt(0) - 0xff10))

/** Seeded generator: the same inputs on every platform, so a failure is reproducible. */
function rng(seed: number) {
	let s = seed >>> 0
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0
		return s / 0x100000000
	}
}

describe("X1-P2 chat titles: the check", () => {
	it("accepts a short plain title and collapses spaces", () => {
		expect(checkTitle("  Baseflow   trends in two basins ")).to.deep.equal({
			ok: true,
			text: "Baseflow trends in two basins",
		})
	})

	it("refuses a bare gauge or site id, a basin key, prj_/st_ ids and a chat ULID, bare or inside words", () => {
		for (const bad of [
			"01031500",
			"USGS 01031500",
			"Gauge 1031500 flows",
			"basin_01031500",
			"basin_0103_p1",
			"prj_01M6ABCDEFG",
			"st_abc123",
			"01JCHATULID0000000000000A",
			"Flows at 1234567890123456",
		]) {
			const r = checkTitle(bad)
			expect(r.ok, bad).to.equal(false)
			if (!r.ok) {
				expect(r.reason, bad).to.equal("id")
			}
		}
	})

	it("refuses decimals and measurements, which belong to cited claims", () => {
		for (const bad of [
			"NSE of 0.82 for the Kentucky basin",
			"Mean flow 3,5 m3/s",
			"Runoff ratio .4",
			"Peak 120 cfs",
			"Area 45 km2",
			"Bias 12%",
			"NSE 80",
			"Slope 5°",
		]) {
			expect(checkTitle(bad).ok, bad).to.equal(false)
		}
		// A year or a small count is not a result.
		expect(checkTitle("Two basins, 1980 to 2010").ok).to.equal(true)
	})

	it("refuses empty, long, multi-line and marked-up text", () => {
		expect(checkTitle("")).to.deep.equal({ ok: false, reason: "empty" })
		expect(checkTitle("   ")).to.deep.equal({ ok: false, reason: "empty" })
		expect(checkTitle("a".repeat(TITLE_MAX + 1))).to.deep.equal({ ok: false, reason: "too_long" })
		expect(checkTitle("first\nsecond")).to.deep.equal({ ok: false, reason: "newline" })
		for (const markup of ["**Bold** title", "<b>x</b>", "`code`", "# Heading", "[a](b)", "- bullet", "a | b"]) {
			expect(checkTitle(markup).ok, markup).to.equal(false)
		}
	})

	it("uses the description cap when asked", () => {
		expect(checkTitle("a ".repeat(60).trim(), DESCRIPTION_MAX).ok).to.equal(true)
		expect(checkTitle("a".repeat(DESCRIPTION_MAX + 1), DESCRIPTION_MAX).ok).to.equal(false)
	})

	it("a user's own name may carry a number, but not be only an id, empty, long, multi-line or markup", () => {
		expect(checkUserTitle("Run 2: low-flow check").ok).to.equal(true)
		expect(checkUserTitle("NSE 0.8 check").ok).to.equal(true)
		expect(checkUserTitle("01031500").ok).to.equal(false)
		expect(checkUserTitle("prj_abc12345").ok).to.equal(false)
		expect(checkUserTitle("").ok).to.equal(false)
		expect(checkUserTitle("x".repeat(61)).ok).to.equal(false)
		expect(checkUserTitle("a\nb").ok).to.equal(false)
		expect(checkUserTitle("<script>").ok).to.equal(false)
	})
})

describe("X1-P2 chat titles: ids in other scripts and split ids", () => {
	it("refuses Arabic-Indic, fullwidth and split-group ids in a title", () => {
		for (const bad of [
			"Basin \u0660\u0661\u0660\u0663\u0661\u0665\u0660\u0660",
			"Basin \uff10\uff11\uff10\uff13\uff11\uff15\uff10\uff10",
			"USGS 0103 1500",
			"01 03 15 00",
			"Site 0103-1500 flows",
		]) {
			const r = checkTitle(bad)
			expect(r.ok, bad).to.equal(false)
		}
		expect(checkTitle("Two basins, 1980 to 2010").ok).to.equal(true)
	})

	it("the fallback drops them and keeps no id suffix", () => {
		expect(fallbackTitle({ task: "Basin \u0660\u0661\u0660\u0663\u0661\u0665\u0660\u0660 flows" })).to.equal("Basin flows")
		expect(fallbackTitle({ task: "Basin 0103 1500 flows" })).to.equal("Basin flows")
		expect(fallbackTitle({ task: "what about st_abc99 here" })).to.equal("What about here")
		expect(fallbackTitle({ task: "check prj_01M6ABCDEF now" })).to.equal("Check now")
	})

	it("a name the user types may not be only an id in any script", () => {
		expect(checkUserTitle("\u0660\u0661\u0660\u0663\u0661\u0665\u0660\u0660").ok).to.equal(false)
		expect(checkUserTitle("0103 1500").ok).to.equal(false)
		expect(checkUserTitle("Run 2 0103").ok).to.equal(true)
	})
})

describe("X1-P2 chat titles: the deterministic fallback", () => {
	// Synthetic text only: no real gauge, site or person.
	it("(c) a map launch is titled by its recorded question, never by the wrapped prompt", () => {
		const wrapped =
			"The user clicked the AI-Hydro map and wants hydrology help for this location.\n## User question\nWhy is the low flow so flat here?"
		const t = fallbackTitle({ origin: "map", userQuestion: "Why is the low flow so flat here?", task: wrapped })
		expect(t).to.equal("Why is the low flow so flat here")
		expect(t).to.not.match(/clicked|AI-Hydro map/i)
	})

	it("a map launch with no question, and an earlier map prompt with no origin, get a generic non-template title", () => {
		const wrapped = "The user clicked the AI-Hydro map and wants hydrology help for this location."
		expect(fallbackTitle({ origin: "map", task: wrapped })).to.equal("Map location question")
		expect(fallbackTitle({ task: wrapped })).to.equal("Map location question")
	})

	it("a plain chat takes the first meaningful words, without openers, ids or results", () => {
		expect(
			fallbackTitle({
				origin: "chat",
				task: "Please can you compare baseflow index between two synthetic basins and report it",
			}),
		).to.equal("Compare baseflow index between two synthetic basins")
		expect(fallbackTitle({ task: "Delineate the watershed for gauge 01031500 and get 12.5 mm runoff" })).to.equal(
			"Delineate the watershed for gauge and get runoff",
		)
	})

	it("adds the study's name (never its id) in front", () => {
		const label = "Synthetic Creek near Testville, XX (USGS 01234567)"
		expect(studyNameFromLabel(label)).to.equal("Synthetic Creek near Testville, XX")
		expect(fallbackTitle({ task: "Check low flow", studyLabel: label })).to.equal(
			"Synthetic Creek near Testville, XX · Check low flow",
		)
		expect(fallbackTitle({ task: "", studyLabel: "01234567" })).to.equal(UNTITLED)
	})

	it("falls back to a generic title when nothing is usable", () => {
		expect(fallbackTitle({ task: "01031500" })).to.equal(UNTITLED)
		expect(fallbackTitle({})).to.equal(UNTITLED)
		expect(fallbackTitle({ origin: "ledger", task: "" })).to.equal("Ledger review")
	})

	it("(b) property: whatever the input, the fallback passes the check, is short, and has no id or decimal", () => {
		const rand = rng(20261029)
		const pieces = [
			"compare",
			"baseflow",
			"the",
			"of",
			"to",
			"01031500",
			"\u0660\u0661\u0660\u0663\u0661\u0665\u0660\u0660",
			"\uff10\uff11\uff10\uff13\uff11\uff15\uff10\uff10",
			"0103",
			"1500",
			"01-03-15-00",
			"basin_0103_p1",
			"prj_01M6ABCDEF",
			"st_abc99",
			"12.5",
			"0,8",
			".4",
			"NSE",
			"KGE=0.7",
			"45km2",
			"120 cfs",
			"85%",
			"mm",
			"Piscataquis",
			"Synthetic",
			"Creek",
			"please",
			"can you",
			"**bold**",
			"`code`",
			"[x](http://u)",
			"<b>",
			"|",
			"#",
			"\n",
			"\t",
			"2020",
			"3",
			"1234567",
			"99999999999999999",
			"ΔQ",
			"ñandú",
			"—",
			"...",
			"?",
			"!",
			"https://example.test/a?b=1.5",
		]
		for (let i = 0; i < 4000; i++) {
			const n = 1 + Math.floor(rand() * 18)
			const words: string[] = []
			for (let j = 0; j < n; j++) {
				words.push(pieces[Math.floor(rand() * pieces.length)])
			}
			const text = words.join(rand() < 0.2 ? "\n" : " ")
			const origin = (["chat", "map", "ledger", "preview", undefined] as const)[Math.floor(rand() * 5)]
			const t = fallbackTitle({
				origin,
				userQuestion: rand() < 0.5 ? text : undefined,
				task: text,
				studyLabel: rand() < 0.4 ? `${words[0]} Creek (${words[1]})` : undefined,
			})
			expect(checkTitle(t).ok, `${JSON.stringify(text)} -> ${JSON.stringify(t)}`).to.equal(true)
			expect(t.length).to.be.at.most(TITLE_MAX)
			// Independent of the check's own patterns:
			const f = fold(t)
			expect(f).to.not.match(/\d[.,]\d/)
			expect(f).to.not.match(/\d(?:[ -]*\d){7}/)
			expect(f).to.not.match(/^\d+$/)
			expect(f).to.not.match(/\b(prj|st)[_ ]|basin[_ ]/i)
			// the suffix of a dropped id token must not survive as plain words either
			expect(t).to.not.match(/abc99|01M6ABCDEF/)
		}
	})

	it("(b) property: nothing the check accepts contains a decimal or a long digit run", () => {
		const rand = rng(7)
		const alphabet = "ab 0123456789.,%_-°mkc\u0660\u0663\u0665\uff10\uff13\uff15"
		let accepted = 0
		for (let i = 0; i < 20000; i++) {
			let s = ""
			const len = 1 + Math.floor(rand() * 24)
			for (let j = 0; j < len; j++) {
				s += alphabet[Math.floor(rand() * alphabet.length)]
			}
			const r = checkTitle(s)
			if (r.ok) {
				accepted++
				expect(fold(r.text)).to.not.match(/\d[.,]\d/)
				expect(fold(r.text)).to.not.match(/\d(?:[ -]*\d){7}/)
			}
		}
		expect(accepted).to.be.greaterThan(100)
	})
})

describe("X1-P2 chat titles: displayTitle", () => {
	it("shows the user's title as typed, a valid stored title, and the fallback for anything else", () => {
		expect(displayTitle({ title: "My own name 2", titleSource: "user", task: "x" })).to.equal("My own name 2")
		expect(displayTitle({ title: "Baseflow in two basins", titleSource: "auto", task: "x" })).to.equal(
			"Baseflow in two basins",
		)
		// A stored automatic title that fails the check (written by something else) is not shown.
		expect(displayTitle({ title: "NSE 0.82 in basin_0103", titleSource: "auto", task: "Compare two basins" })).to.equal(
			"Compare two basins",
		)
		// No title at all: the fallback, never the raw prompt.
		expect(displayTitle({ task: "The user clicked the AI-Hydro map and wants hydrology help for this location." })).to.equal(
			"Map location question",
		)
	})

	it("a chat the user named or a model titled is not a bulk candidate", () => {
		expect(isBulkTitleCandidate({})).to.equal(true)
		expect(isBulkTitleCandidate({ titleSource: "fallback" })).to.equal(true)
		expect(isBulkTitleCandidate({ titleSource: "auto" })).to.equal(false)
		expect(isBulkTitleCandidate({ titleSource: "user" })).to.equal(false)
		expect(estimateBulkTitleTokens(23)).to.equal(23 * 1580)
	})
})
