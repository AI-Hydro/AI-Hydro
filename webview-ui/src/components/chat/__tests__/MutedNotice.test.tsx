import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { MutedNotice, splitNotice } from "../MutedNotice"

describe("MutedNotice", () => {
	it("splits the muted line from raw detail at the first blank line", () => {
		expect(splitNotice("one line")).toEqual({ line: "one line" })
		expect(splitNotice("line\n\nraw <tool_calls>\nmore")).toEqual({ line: "line", detail: "raw <tool_calls>\nmore" })
	})

	it("renders one muted line; raw text only behind a disclosure", () => {
		const { container } = render(<MutedNotice text={"malformed tool call; retried\n\n<tool_calls>x</tool_calls>"} />)
		expect(container.textContent).toContain("malformed tool call; retried")
		const details = container.querySelector("details")
		expect(details).not.toBeNull()
		expect(details?.hasAttribute("open")).toBe(false)
		expect(details?.textContent).toContain("<tool_calls>x</tool_calls>")
	})

	it("renders nothing for empty text", () => {
		const { container } = render(<MutedNotice text="  " />)
		expect(container.innerHTML).toBe("")
	})
})
