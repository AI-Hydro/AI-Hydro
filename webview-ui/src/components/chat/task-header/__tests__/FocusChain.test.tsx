import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { FocusChain } from "../FocusChain"

describe("FocusChain header", () => {
	it("labels the list as self-reported and does not celebrate completion", () => {
		const { container } = render(<FocusChain lastProgressMessageText={"- [x] load\n- [x] analyse"} />)
		const text = container.textContent ?? ""
		expect(text).toContain("Agent to-do (self-reported) 2/2")
		expect(text).not.toContain("!")
		expect(text.toLowerCase()).not.toContain("completed")
	})

	it("shows completed/total for a partly done list", () => {
		const { container } = render(<FocusChain lastProgressMessageText={"- [x] load\n- [ ] analyse\n- [ ] report"} />)
		expect(container.textContent).toContain("Agent to-do (self-reported) 1/3")
		expect(container.textContent).toContain("analyse")
	})
})
