import { describe, expect, it } from "vitest"
import { httpUrlOrEmpty } from "../marketplace/safeUrl"

describe("httpUrlOrEmpty", () => {
	it("allows only http(s)", () => {
		expect(httpUrlOrEmpty("https://doi.org/10.1/x")).toBe("https://doi.org/10.1/x")
		expect(httpUrlOrEmpty("javascript:alert(1)")).toBe("")
		expect(httpUrlOrEmpty("file:///etc/passwd")).toBe("")
		expect(httpUrlOrEmpty(undefined)).toBe("")
	})
})
